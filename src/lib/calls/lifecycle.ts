import { query, SCHEMA } from "@/lib/db";
import { runCallPostProcessing } from "@/lib/calls/callGeminiPostProcess";
import { notifyCallParticipants } from "@/lib/calls/notifications";
import { postCallChatSystemMessage } from "@/lib/calls/chat";
import {
  isCallRecordingEnabled,
  CALL_IDLE_GRACE_MS,
  CALL_STALE_LOBBY_MS,
  CALL_STALE_PARTICIPANT_MS,
  RECORDING_UPLOAD_FALLBACK_MS,
  roomNameForCall,
} from "@/lib/calls/constants";
import {
  startLiveKitAgent,
  stopLiveKitAgent,
} from "@/lib/livekit/agentDispatch";
import { hasLiveTranscriptContent } from "@/lib/calls/liveSession";
import { runFinalMeetingAiPass } from "@/lib/calls/liveMeetingAi";
import {
  PROCESSING_MILESTONES,
  setCallProcessingProgress,
} from "@/lib/calls/processingProgress";
import type { CallSessionRow } from "@/types/calls";

const processingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const recordingFallbackTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

export function clearProcessingTimer(callId: string): void {
  const existing = processingTimers.get(callId);
  if (existing) {
    clearTimeout(existing);
    processingTimers.delete(callId);
  }
  const fallback = recordingFallbackTimers.get(callId);
  if (fallback) {
    clearTimeout(fallback);
    recordingFallbackTimers.delete(callId);
  }
}

async function countActiveParticipants(callId: string): Promise<number> {
  const active = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ${SCHEMA}.call_participants
     WHERE call_session_id = $1 AND joined_at IS NOT NULL AND left_at IS NULL`,
    [callId],
  );
  return parseInt(active.rows[0]?.n ?? "0", 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function forceRedispatchAgent(
  call: CallSessionRow,
  _appBaseUrl: string,
): Promise<void> {
  if (!call.ai_enabled) return;

  if (call.livekit_agent_dispatch_id) {
    const roomName =
      call.livekit_room_name ?? roomNameForCall(call.workspace_id, call.id);
    try {
      await stopLiveKitAgent(call.livekit_agent_dispatch_id, roomName);
    } catch {
      /* best effort */
    }
    await query(
      `UPDATE ${SCHEMA}.call_sessions
       SET livekit_agent_dispatch_id = NULL, updated_at = NOW()
       WHERE id = $1`,
      [call.id],
    );
  }

  await maybeStartAgent(
    { ...call, livekit_agent_dispatch_id: null },
    _appBaseUrl,
  );
}

export async function maybeStartAgent(
  call: CallSessionRow,
  _appBaseUrl: string,
): Promise<void> {
  if (!call.ai_enabled || call.livekit_agent_dispatch_id) return;
  const roomName =
    call.livekit_room_name ?? roomNameForCall(call.workspace_id, call.id);
  try {
    const dispatchId = await startLiveKitAgent(roomName, {
      call_id: call.id,
      workspace_id: call.workspace_id,
    });
    await query(
      `UPDATE ${SCHEMA}.call_sessions
       SET livekit_agent_dispatch_id = $2,
           livekit_room_name = COALESCE(livekit_room_name, $3),
           metadata = metadata || $4::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        call.id,
        dispatchId,
        roomName,
        JSON.stringify({
          agent_status: "dispatched",
          agent_started_at: new Date().toISOString(),
        }),
      ],
    );
    await postCallChatSystemMessage(
      call.conversation_id,
      call.created_by,
      "OneWork AI assistant joined the call.",
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Agent start failed";
    await query(
      `UPDATE ${SCHEMA}.call_sessions
       SET metadata = metadata || $2::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [call.id, JSON.stringify({ agent_error: msg })],
    );
  }
}

export async function stopAgentIfRunning(call: CallSessionRow): Promise<void> {
  if (!call.livekit_agent_dispatch_id) return;
  const roomName =
    call.livekit_room_name ?? roomNameForCall(call.workspace_id, call.id);
  try {
    await stopLiveKitAgent(call.livekit_agent_dispatch_id, roomName);
  } catch {
    /* best effort */
  }
  await query(
    `UPDATE ${SCHEMA}.call_sessions
     SET livekit_agent_dispatch_id = NULL, updated_at = NOW()
     WHERE id = $1`,
    [call.id],
  );
  await postCallChatSystemMessage(
    call.conversation_id,
    call.created_by,
    "OneWork AI assistant left the call.",
  );
}

export async function scheduleProcessingIfEmpty(callId: string): Promise<void> {
  if ((await countActiveParticipants(callId)) > 0) return;

  const existing = processingTimers.get(callId);
  if (existing) clearTimeout(existing);

  processingTimers.set(
    callId,
    setTimeout(() => {
      void beginCallProcessing(callId);
      processingTimers.delete(callId);
    }, CALL_IDLE_GRACE_MS),
  );
}

/** Returns true when post-call processing was started. */
export async function beginCallProcessing(callId: string): Promise<boolean> {
  const callRes = await query<CallSessionRow>(
    `SELECT * FROM ${SCHEMA}.call_sessions WHERE id = $1 LIMIT 1`,
    [callId],
  );
  const call = callRes.rows[0];
  // Allow recovery of calls that are already in `processing` status — this
  // happens when a Next.js hot-reload kills the in-memory timer after the
  // status was already set, leaving the call permanently stuck.
  if (!call || !["live", "processing"].includes(call.status)) return false;

  let activeCount = await countActiveParticipants(callId);
  if (activeCount > 0) {
    await sleep(250);
    activeCount = await countActiveParticipants(callId);
  }
  if (activeCount > 0) return false;

  clearProcessingTimer(callId);

  await stopAgentIfRunning(call);

  await setCallProcessingProgress(callId, PROCESSING_MILESTONES.savingTranscript, {
    phase: "ending",
    stepLabel: "Saving meeting notes",
  });

  const artEarly = await query<{ status: string }>(
    `SELECT status FROM ${SCHEMA}.call_ai_artifacts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const artEarlyStatus = artEarly.rows[0]?.status;
  if (
    call.status === "processing" &&
    (artEarlyStatus === "ready" || artEarlyStatus === "skipped")
  ) {
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

  const meta = (call.metadata ?? {}) as { processing_phase?: string };
  if (call.status === "processing" && meta.processing_phase === "done") {
    return false;
  }

  const alreadyProcessing = call.status === "processing";

  if (!call.recording_enabled) {
    if (call.ai_enabled) {
      const hasLiveNoRec = await hasLiveTranscriptContent(callId);
      if (hasLiveNoRec) {
        await setCallProcessingProgress(
          callId,
          PROCESSING_MILESTONES.finalAiStart,
          { stepLabel: "Finalizing live notes" },
        );
        await runFinalMeetingAiPass(callId);
        await setCallProcessingProgress(
          callId,
          PROCESSING_MILESTONES.finalAiDone,
          { stepLabel: "Live notes saved" },
        );
      }
      if (!alreadyProcessing) {
        await query(
          `UPDATE ${SCHEMA}.call_sessions
           SET status = 'processing',
               ended_at = COALESCE(ended_at, NOW()),
               metadata = metadata || $2::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [
            callId,
            JSON.stringify({
              processing_started_at: new Date().toISOString(),
            }),
          ],
        );
      }
      await runCallPostProcessing(callId);
      return true;
    }
    await query(
      `UPDATE ${SCHEMA}.call_sessions
       SET status = 'completed',
           ended_at = COALESCE(ended_at, NOW()),
           metadata = metadata || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        callId,
        JSON.stringify({
          processing_phase: "done",
          processing_progress: PROCESSING_MILESTONES.done,
          processing_step_label: "Complete",
          post_call_skipped_reason: "recording_disabled",
        }),
      ],
    );
    const existingArt = await query<{ id: string }>(
      `SELECT id FROM ${SCHEMA}.call_ai_artifacts WHERE call_session_id = $1 LIMIT 1`,
      [callId],
    );
    if (!existingArt.rows[0]) {
      await query(
        `INSERT INTO ${SCHEMA}.call_ai_artifacts (call_session_id, summary, status)
         VALUES ($1, $2, 'skipped')`,
        [
          callId,
          "Recording was off for this call; no AI summary was generated.",
        ],
      );
    }
    const participantsRes = await query<{ user_id: string }>(
      `SELECT user_id FROM ${SCHEMA}.call_participants WHERE call_session_id = $1`,
      [callId],
    );
    await notifyCallParticipants(
      participantsRes.rows.map((p) => p.user_id),
      "Call ended",
      `${call.title} has ended.`,
      "call_summary",
      callId,
      "callSummaries",
    );
    return true;
  }

  const waitsForUpload = call.recording_enabled && isCallRecordingEnabled();

  if (!alreadyProcessing) {
    await query(
      `UPDATE ${SCHEMA}.call_sessions
       SET status = 'processing',
           ended_at = COALESCE(ended_at, NOW()),
           metadata = metadata || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        callId,
        JSON.stringify({ processing_started_at: new Date().toISOString() }),
      ],
    );
  }

  const participantsRes = await query<{ user_id: string }>(
    `SELECT user_id FROM ${SCHEMA}.call_participants WHERE call_session_id = $1`,
    [callId],
  );
  await notifyCallParticipants(
    participantsRes.rows.map((p) => p.user_id),
    "Call ended",
    `${call.title} has ended. Processing recording and summary.`,
    "call_summary",
    callId,
    "callSummaries",
  );

  const transcriptRes = await query<{ id: string; status: string }>(
    `SELECT id, status FROM ${SCHEMA}.call_transcripts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  let transcript = transcriptRes.rows[0];
  if (!transcript) {
    await query(
      `INSERT INTO ${SCHEMA}.call_transcripts (call_session_id, status)
       VALUES ($1, 'processing')`,
      [callId],
    );
  }

  const hasLive = await hasLiveTranscriptContent(callId);

  if (call.ai_enabled && hasLive) {
    await setCallProcessingProgress(
      callId,
      PROCESSING_MILESTONES.finalAiStart,
      { stepLabel: "Finalizing live notes" },
    );
    await runFinalMeetingAiPass(callId);
    await setCallProcessingProgress(
      callId,
      PROCESSING_MILESTONES.finalAiDone,
      { stepLabel: "Live notes saved" },
    );
  }

  if (waitsForUpload && !hasLive) {
    await setCallProcessingProgress(
      callId,
      PROCESSING_MILESTONES.uploadBandMin,
      {
        phase: "waiting_upload",
        stepLabel: "Waiting for recording upload",
      },
    );
    const existingFallback = recordingFallbackTimers.get(callId);
    if (existingFallback) clearTimeout(existingFallback);
    recordingFallbackTimers.set(
      callId,
      setTimeout(() => {
        recordingFallbackTimers.delete(callId);
        void runCallPostProcessing(callId);
      }, RECORDING_UPLOAD_FALLBACK_MS),
    );
    return true;
  }

  await runCallPostProcessing(callId);
  return true;
}

export async function dispatchScheduledReminders(
  workspaceId: string,
): Promise<void> {
  const now = Date.now();
  const calls = await query<CallSessionRow>(
    `SELECT * FROM ${SCHEMA}.call_sessions
     WHERE workspace_id = $1 AND status = 'scheduled'
       AND scheduled_start_at IS NOT NULL`,
    [workspaceId],
  );

  for (const call of calls.rows) {
    if (!call.scheduled_start_at) continue;
    const start = new Date(call.scheduled_start_at).getTime();
    const meta = (call.metadata ?? {}) as Record<string, unknown>;
    const sent = (meta.reminders_sent ?? {}) as Record<string, boolean>;
    const mins = (start - now) / 60_000;

    const participantsRes = await query<{ user_id: string }>(
      `SELECT user_id FROM ${SCHEMA}.call_participants WHERE call_session_id = $1`,
      [call.id],
    );
    const ids = participantsRes.rows.map((p) => p.user_id);

    if (mins <= 15 && mins > 14 && !sent.t15) {
      await notifyCallParticipants(
        ids,
        "Call starting in 15 minutes",
        call.title,
        "call_reminder",
        call.id,
        "callReminders",
      );
      sent.t15 = true;
    }
    if (mins <= 2 && mins > 1 && !sent.t2) {
      await notifyCallParticipants(
        ids,
        "Call starting in 2 minutes",
        call.title,
        "call_reminder",
        call.id,
        "callReminders",
      );
      sent.t2 = true;
    }
    if (sent.t15 || sent.t2) {
      await query(
        `UPDATE ${SCHEMA}.call_sessions
         SET metadata = metadata || $2::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [call.id, JSON.stringify({ reminders_sent: sent })],
      );
    }
  }
}

/** After workspace file storage rejects a recording upload: no Gemini run. */
export async function finalizePostCallSkippedStorageLimit(
  callId: string,
): Promise<void> {
  clearProcessingTimer(callId);
  const existingArt = await query<{ id: string }>(
    `SELECT id FROM ${SCHEMA}.call_ai_artifacts WHERE call_session_id = $1 LIMIT 1`,
    [callId],
  );
  if (!existingArt.rows[0]) {
    await query(
      `INSERT INTO ${SCHEMA}.call_ai_artifacts (call_session_id, summary, status)
       VALUES ($1, $2, 'skipped')`,
      [
        callId,
        "Recording could not be saved because the workspace file storage limit was reached.",
      ],
    );
  }
  await query(
    `UPDATE ${SCHEMA}.call_sessions
     SET status = 'completed',
         metadata = metadata || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      callId,
      JSON.stringify({
        post_call_skipped_reason: "storage_limit",
        post_call_skipped_at: new Date().toISOString(),
        processing_phase: "done",
      }),
    ],
  );
}

/** When the last participant leaves a live call, move it into post-call processing. */
export async function finalizeCallAfterParticipantLeave(
  callId: string,
): Promise<void> {
  const callRes = await query<CallSessionRow>(
    `SELECT * FROM ${SCHEMA}.call_sessions WHERE id = $1 LIMIT 1`,
    [callId],
  );
  const call = callRes.rows[0];
  if (!call || call.status !== "live") return;
  if ((await countActiveParticipants(callId)) > 0) return;
  void beginCallProcessing(callId).catch((e: unknown) => {
    console.error("[calls] finalizeCallAfterParticipantLeave", callId, e);
  });
}

/**
 * Clears ghost participants, cancels abandoned lobbies, and finalizes empty live calls.
 * Safe to run on each calls list fetch (same pattern as scheduled reminders).
 */
export async function reconcileStaleCallSessions(
  workspaceId: string,
): Promise<void> {
  const staleParticipantBefore = new Date(
    Date.now() - CALL_STALE_PARTICIPANT_MS,
  ).toISOString();
  const staleLobbyBefore = new Date(
    Date.now() - CALL_STALE_LOBBY_MS,
  ).toISOString();
  const emptyLiveBefore = new Date(
    Date.now() - CALL_IDLE_GRACE_MS,
  ).toISOString();

  await query(
    `UPDATE ${SCHEMA}.call_participants cp
     SET left_at = NOW()
     FROM ${SCHEMA}.call_sessions cs
     WHERE cp.call_session_id = cs.id
       AND cs.workspace_id = $1
       AND cs.status IN ('live', 'lobby')
       AND cp.joined_at IS NOT NULL
       AND cp.left_at IS NULL
       AND cp.joined_at < $2::timestamptz`,
    [workspaceId, staleParticipantBefore],
  );

  await query(
    `UPDATE ${SCHEMA}.call_sessions
     SET status = 'cancelled', updated_at = NOW()
     WHERE workspace_id = $1
       AND status = 'lobby'
       AND created_at < $2::timestamptz
       AND NOT EXISTS (
         SELECT 1 FROM ${SCHEMA}.call_participants cp
         WHERE cp.call_session_id = call_sessions.id
           AND cp.joined_at IS NOT NULL
           AND cp.left_at IS NULL
       )`,
    [workspaceId, staleLobbyBefore],
  );

  const emptyLive = await query<{ id: string }>(
    `SELECT cs.id
     FROM ${SCHEMA}.call_sessions cs
     WHERE cs.workspace_id = $1
       AND cs.status = 'live'
       AND NOT EXISTS (
         SELECT 1 FROM ${SCHEMA}.call_participants cp
         WHERE cp.call_session_id = cs.id
           AND cp.joined_at IS NOT NULL
           AND cp.left_at IS NULL
       )
       AND (
         SELECT COALESCE(MAX(cp.left_at), cs.started_at, cs.created_at)
         FROM ${SCHEMA}.call_participants cp
         WHERE cp.call_session_id = cs.id
       ) < $2::timestamptz`,
    [workspaceId, emptyLiveBefore],
  );

  for (const row of emptyLive.rows) {
    try {
      await beginCallProcessing(row.id);
    } catch (e: unknown) {
      console.error("[calls] reconcileStaleCallSessions", row.id, e);
    }
  }
}
