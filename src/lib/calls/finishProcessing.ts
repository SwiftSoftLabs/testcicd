import { runCallPostProcessing } from "@/lib/calls/callGeminiPostProcess";
import { hasLiveTranscriptContent } from "@/lib/calls/liveSession";
import { query, SCHEMA } from "@/lib/db";
import { RECORDING_UPLOAD_FALLBACK_MS } from "@/lib/calls/constants";
import type { CallSessionRow } from "@/types/calls";

const inFlightResume = new Set<string>();

/** @deprecated Use runCallPostProcessing */
export async function finishCallProcessingAfterRecording(
  callId: string,
): Promise<void> {
  await runCallPostProcessing(callId);
}

function processingAgeMs(call: CallSessionRow): number {
  const meta = (call.metadata ?? {}) as { processing_started_at?: string };
  const started =
    meta.processing_started_at ?? call.ended_at ?? call.updated_at;
  if (!started) return 0;
  return Date.now() - new Date(started).getTime();
}

/** @returns true if a resume run was started */
export async function resumeStaleCallProcessing(
  callId: string,
  opts?: { force?: boolean },
): Promise<boolean> {
  if (inFlightResume.has(callId)) return false;

  const callRes = await query<CallSessionRow>(
    `SELECT * FROM ${SCHEMA}.call_sessions WHERE id = $1 LIMIT 1`,
    [callId],
  );
  const call = callRes.rows[0];
  if (!call || call.status !== "processing") return false;

  const artifact = await query<{ status: string }>(
    `SELECT status FROM ${SCHEMA}.call_ai_artifacts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const artStatus = artifact.rows[0]?.status;
  if (artStatus === "ready" || artStatus === "skipped") {
    await query(
      `UPDATE ${SCHEMA}.call_sessions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [callId],
    );
    return false;
  }

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
  const uploaded =
    recording?.status === "uploaded" &&
    (!!recording.storage_key || !!recording.workspace_file_id);
  const age = processingAgeMs(call);

  const hasLive = await hasLiveTranscriptContent(callId);
  if (
    !opts?.force &&
    !uploaded &&
    !hasLive &&
    age < RECORDING_UPLOAD_FALLBACK_MS
  ) {
    return false;
  }

  inFlightResume.add(callId);
  try {
    await runCallPostProcessing(callId);
    return true;
  } finally {
    inFlightResume.delete(callId);
  }
}
