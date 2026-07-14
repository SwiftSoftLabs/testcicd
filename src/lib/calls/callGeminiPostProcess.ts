import {
  isOpenRouterMeetingAiConfigured,
  mapOpenRouterClientError,
} from "@/lib/ai/openRouterChat";
import {
  getWhisperTranscriptionModelId,
  MAX_TRANSCRIPTION_BYTES,
  MEETING_TRANSCRIPTION_PROMPT,
  transcribeWithWhisperLargeV3,
} from "@/lib/ai/transcribeAudio";
import {
  buildMeetingContextBundle,
  formatContextForPrompt,
} from "@/lib/ai/meetingContext";
import { type MeetingAiOutput } from "@/lib/ai/meetingProcessor";
import { createDraftMeetingTask } from "@/lib/ai/meetingTools";
import { summarizeTranscriptWithMeetingAi } from "@/lib/calls/liveMeetingAiClient";
import { query, SCHEMA } from "@/lib/db";
import {
  RECORDING_UPLOAD_FALLBACK_MS,
  isCallRecordingEnabled,
} from "@/lib/calls/constants";
import { hasLiveTranscriptContent } from "@/lib/calls/liveSession";
import { buildTranscriptText } from "@/lib/calls/transcriptSegments";
import type { TranscriptSegment } from "@/types/calls";
import { recordingMimeFromKey } from "@/lib/calls/localRecording";
import { downloadCallRecordingBlob } from "@/lib/calls/storage";
import {
  PROCESSING_MILESTONES,
  setCallProcessingProgress,
} from "@/lib/calls/processingProgress";
import type { CallSessionRow } from "@/types/calls";

const PHASE_PROGRESS: Record<
  CallProcessingPhase,
  { percent: number; label: string }
> = {
  waiting_upload: {
    percent: PROCESSING_MILESTONES.uploadBandMin,
    label: "Waiting for recording upload",
  },
  analyzing_recording: {
    percent: PROCESSING_MILESTONES.analyzingRecording,
    label: "Analyzing recording",
  },
  summarizing: {
    percent: PROCESSING_MILESTONES.summarizing,
    label: "Writing summary and action items",
  },
  done: {
    percent: PROCESSING_MILESTONES.done,
    label: "Complete",
  },
  failed: {
    percent: PROCESSING_MILESTONES.failed,
    label: "Processing failed",
  },
};

function processingAgeMs(call: CallSessionRow): number {
  const meta = (call.metadata ?? {}) as { processing_started_at?: string };
  const started =
    meta.processing_started_at ?? call.ended_at ?? call.updated_at;
  if (!started) return 0;
  return Date.now() - new Date(started).getTime();
}

export type CallProcessingPhase =
  | "waiting_upload"
  | "analyzing_recording"
  | "summarizing"
  | "done"
  | "failed";

async function setProcessingPhase(
  callId: string,
  phase: CallProcessingPhase,
): Promise<void> {
  const mapped = PHASE_PROGRESS[phase];
  await setCallProcessingProgress(callId, mapped.percent, {
    phase,
    stepLabel: mapped.label,
  });
}

async function saveTranscript(callId: string, fullText: string): Promise<void> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM ${SCHEMA}.call_transcripts WHERE call_session_id = $1 LIMIT 1`,
    [callId],
  );
  if (existing.rows[0]) {
    await query(
      `UPDATE ${SCHEMA}.call_transcripts
       SET full_text = $2, status = 'ready', updated_at = NOW()
       WHERE call_session_id = $1`,
      [callId, fullText],
    );
  } else {
    await query(
      `INSERT INTO ${SCHEMA}.call_transcripts (call_session_id, full_text, status)
       VALUES ($1, $2, 'ready')`,
      [callId, fullText],
    );
  }
}

async function saveArtifactAndTasks(
  call: CallSessionRow,
  parsed: MeetingAiOutput,
  modelId: string,
  transcriptForDb: string,
): Promise<void> {
  await saveTranscript(call.id, transcriptForDb);

  const titlesRes = await query<{ title: string }>(
    `SELECT title FROM ${SCHEMA}.tasks WHERE source_call_id = $1`,
    [call.id],
  );
  const existing = titlesRes.rows.map((r) => r.title.toLowerCase());

  for (const item of parsed.actionItems) {
    const t = item.title.toLowerCase().trim();
    if (!t || existing.some((e) => e === t || e.includes(t) || t.includes(e))) {
      continue;
    }
    await createDraftMeetingTask(call, item, call.created_by);
    existing.push(t);
  }

  const artExisting = await query<{ id: string }>(
    `SELECT id FROM ${SCHEMA}.call_ai_artifacts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [call.id],
  );
  if (artExisting.rows[0]) {
    await query(
      `UPDATE ${SCHEMA}.call_ai_artifacts
       SET summary = $2, key_decisions = $3::jsonb, raw_response = $4::jsonb,
           model_id = $5, status = 'ready'
       WHERE id = $1`,
      [
        artExisting.rows[0].id,
        parsed.summary,
        JSON.stringify(parsed.keyDecisions),
        JSON.stringify(parsed),
        modelId,
      ],
    );
  } else {
    await query(
      `INSERT INTO ${SCHEMA}.call_ai_artifacts
       (call_session_id, summary, key_decisions, raw_response, model_id, status)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, 'ready')`,
      [
        call.id,
        parsed.summary,
        JSON.stringify(parsed.keyDecisions),
        JSON.stringify(parsed),
        modelId,
      ],
    );
  }

  await query(
    `UPDATE ${SCHEMA}.call_sessions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
    [call.id],
  );
  await setCallProcessingProgress(call.id, PROCESSING_MILESTONES.done, {
    phase: "done",
    stepLabel: "Complete",
  });
}

async function markFailed(callId: string, message: string): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.call_ai_artifacts
     (call_session_id, summary, status, raw_response)
     VALUES ($1, $2, 'failed', $3::jsonb)`,
    [callId, message.slice(0, 500), JSON.stringify({ error: message })],
  );
  await query(
    `UPDATE ${SCHEMA}.call_sessions SET status = 'failed', updated_at = NOW() WHERE id = $1`,
    [callId],
  );
  await setProcessingPhase(callId, "failed");
}

/** Skip duplicate summarization when runFinalMeetingAiPass already produced a ready artifact. */
async function completeCallIfArtifactReady(callId: string): Promise<boolean> {
  const art = await query<{ status: string; summary: string | null }>(
    `SELECT status, summary FROM ${SCHEMA}.call_ai_artifacts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const row = art.rows[0];
  if (row?.status !== "ready" || !row.summary?.trim()) return false;

  await query(
    `UPDATE ${SCHEMA}.call_sessions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
    [callId],
  );
  await setCallProcessingProgress(callId, PROCESSING_MILESTONES.done, {
    phase: "done",
    stepLabel: "Complete",
  });
  return true;
}

/**
 * End-to-end post-call AI: recording → Whisper transcript → model gateway summary.
 * Safe to call from upload webhook, resume endpoint, or idle timer.
 */
/** When a recording lands after a fallback summary, replace prior AI output. */
export async function resetCallAiForRecordingUpload(
  callId: string,
): Promise<void> {
  const hasLive = await hasLiveTranscriptContent(callId);
  const art = await query<{ status: string }>(
    `SELECT status FROM ${SCHEMA}.call_ai_artifacts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const artStatus = art.rows[0]?.status ?? "";
  if (hasLive && (artStatus === "ready" || artStatus === "processing")) {
    return;
  }
  await query(
    `DELETE FROM ${SCHEMA}.call_ai_artifacts WHERE call_session_id = $1`,
    [callId],
  );
  await query(
    `UPDATE ${SCHEMA}.call_sessions
     SET status = 'processing', updated_at = NOW()
     WHERE id = $1 AND status IN ('processing', 'completed', 'failed')`,
    [callId],
  );
}

export async function runCallPostProcessing(callId: string): Promise<void> {
  const callRes = await query<CallSessionRow>(
    `SELECT * FROM ${SCHEMA}.call_sessions WHERE id = $1 LIMIT 1`,
    [callId],
  );
  const call = callRes.rows[0];
  if (!call) return;

  if (!call.recording_enabled) {
    if (!call.ai_enabled) {
      if (call.status === "processing") {
        await query(
          `UPDATE ${SCHEMA}.call_sessions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
          [callId],
        );
      }
      return;
    }
    /* AI-only calls: fall through to transcript summarization below. */
  }

  const skipMeta = (call.metadata ?? {}) as {
    post_call_skipped_reason?: string;
  };
  if (skipMeta.post_call_skipped_reason === "storage_limit") return;

  const recEarly = await query<{
    storage_key: string | null;
    workspace_file_id: string | null;
    status: string;
  }>(
    `SELECT storage_key, workspace_file_id, status FROM ${SCHEMA}.call_recordings
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const recordingEarly = recEarly.rows[0];
  const hasUploadEarly =
    recordingEarly?.status === "uploaded" &&
    (!!recordingEarly.storage_key || !!recordingEarly.workspace_file_id);

  const hasLiveEarly = await hasLiveTranscriptContent(callId);

  if (
    call.recording_enabled &&
    isCallRecordingEnabled() &&
    !hasUploadEarly &&
    !hasLiveEarly
  ) {
    const age = processingAgeMs(call);
    if (age < RECORDING_UPLOAD_FALLBACK_MS) {
      await setProcessingPhase(callId, "waiting_upload");
      return;
    }
  }

  const existing = await query<{ status: string }>(
    `SELECT status FROM ${SCHEMA}.call_ai_artifacts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const artStatus = existing.rows[0]?.status ?? "";
  if (artStatus === "failed") {
    await query(
      `DELETE FROM ${SCHEMA}.call_ai_artifacts
       WHERE call_session_id = $1 AND status = 'failed'`,
      [callId],
    );
    if (call.status === "failed") {
      await query(
        `UPDATE ${SCHEMA}.call_sessions SET status = 'processing', updated_at = NOW() WHERE id = $1`,
        [callId],
      );
    }
  } else if (["ready", "skipped"].includes(artStatus)) {
    if (call.status === "processing") {
      await query(
        `UPDATE ${SCHEMA}.call_sessions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [callId],
      );
    }
    return;
  }

  if (!call.ai_enabled) {
    await query(
      `INSERT INTO ${SCHEMA}.call_ai_artifacts
       (call_session_id, summary, status)
       VALUES ($1, $2, 'skipped')`,
      [callId, "AI processing was disabled for this call."],
    );
    await query(
      `UPDATE ${SCHEMA}.call_sessions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [callId],
    );
    return;
  }

  if (!isOpenRouterMeetingAiConfigured()) {
    await markFailed(
      callId,
      "OPENROUTER_API_KEY not configured for meeting AI",
    );
    return;
  }

  const participantsRes = await query<{ user_id: string }>(
    `SELECT user_id FROM ${SCHEMA}.call_participants WHERE call_session_id = $1`,
    [callId],
  );
  const participantIds = participantsRes.rows.map((p) => p.user_id);
  const bundle = await buildMeetingContextBundle(call, participantIds);
  const contextText = formatContextForPrompt(bundle);

  const rec = await query<{
    storage_key: string | null;
    workspace_file_id: string | null;
    status: string;
  }>(
    `SELECT storage_key, workspace_file_id, status FROM ${SCHEMA}.call_recordings
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const recording = rec.rows[0];
  const hasUpload =
    recording?.status === "uploaded" &&
    (!!recording.storage_key || !!recording.workspace_file_id);

  try {
    if (hasUpload && !(await hasLiveTranscriptContent(callId))) {
      await setProcessingPhase(callId, "analyzing_recording");

      const { blob, pathForMime } = await downloadCallRecordingBlob(callId);
      if (!blob || blob.size === 0) {
        throw new Error("Recording file missing from storage");
      }

      const buffer = Buffer.from(await blob.arrayBuffer());
      const mimeType = recordingMimeFromKey(pathForMime, blob.type);

      if (buffer.length > MAX_TRANSCRIPTION_BYTES) {
        await setProcessingPhase(callId, "summarizing");
        const note =
          "(Recording was too large for full transcription; summary from meeting context only.)";
        const { output: meeting, modelId } =
          await summarizeTranscriptWithMeetingAi(note, contextText);
        await saveArtifactAndTasks(call, meeting, modelId, note);
        return;
      }

      const transcript = await transcribeWithWhisperLargeV3({
        buffer,
        mimeType,
        language: "en",
        prompt: MEETING_TRANSCRIPTION_PROMPT,
      });

      await setProcessingPhase(callId, "summarizing");
      const { output: meeting, modelId } =
        await summarizeTranscriptWithMeetingAi(transcript, contextText);
      await saveArtifactAndTasks(
        call,
        meeting,
        `${getWhisperTranscriptionModelId()} + ${modelId}`,
        transcript,
      );
      return;
    }

    if (await completeCallIfArtifactReady(callId)) {
      return;
    }

    await setProcessingPhase(callId, "summarizing");
    const tr = await query<{
      full_text: string | null;
      segments: TranscriptSegment[];
    }>(
      `SELECT full_text, segments FROM ${SCHEMA}.call_transcripts
       WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [callId],
    );
    const row = tr.rows[0];
    const transcript = buildTranscriptText(
      row?.segments ?? [],
      row?.full_text,
    ).trim();

    const { output: meeting, modelId } =
      await summarizeTranscriptWithMeetingAi(
        transcript || "(No recording or transcript available for this call.)",
        contextText,
      );
    await saveArtifactAndTasks(call, meeting, modelId, transcript);
  } catch (e: unknown) {
    const { message } = mapOpenRouterClientError(e);
    console.error("[runCallPostProcessing]", callId, message);
    await markFailed(callId, message);
  }
}
