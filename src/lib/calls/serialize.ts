import { query, SCHEMA } from "@/lib/db";
import { buildTranscriptText } from "@/lib/calls/transcriptSegments";
import type {
  CallSessionDetail,
  CallSessionRow,
  CallSyncPayload,
  CallParticipantRow,
  CallRecordingStatus,
  CallTranscriptStatus,
  CallAiArtifactStatus,
  TranscriptSegment,
} from "@/types/calls";

export async function loadCallDetail(
  call: CallSessionRow,
): Promise<CallSessionDetail> {
  const participants = await query(
    `SELECT cp.*,
            COALESCE(NULLIF(TRIM(p.full_name), ''), NULLIF(TRIM(p.email), ''), 'Member') AS display_name,
            p.avatar_url
     FROM ${SCHEMA}.call_participants cp
     LEFT JOIN ${SCHEMA}.profiles p ON p.id = cp.user_id
     WHERE cp.call_session_id = $1`,
    [call.id],
  );

  const recording = await query<{
    id: string;
    playback_url: string | null;
    duration_seconds: number | null;
    status: CallRecordingStatus;
  }>(
    `SELECT id, playback_url, duration_seconds, status
     FROM ${SCHEMA}.call_recordings
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [call.id],
  );

  const transcript = await query<{
    id: string;
    full_text: string | null;
    segments: TranscriptSegment[];
    status: CallTranscriptStatus;
  }>(
    `SELECT id, full_text, segments, status
     FROM ${SCHEMA}.call_transcripts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [call.id],
  );

  const ai = await query<{
    id: string;
    summary: string | null;
    key_decisions: string[];
    live_notes: unknown[];
    status: CallAiArtifactStatus;
  }>(
    `SELECT id, summary, key_decisions, live_notes, status
     FROM ${SCHEMA}.call_ai_artifacts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [call.id],
  );

  const pending = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ${SCHEMA}.meeting_task_reviews
     WHERE call_session_id = $1
       AND review_status IN ('pending', 'acknowledged')`,
    [call.id],
  );

  const rec = recording.rows[0];
  const tr = transcript.rows[0];
  const art = ai.rows[0];

  return {
    ...call,
    participants: participants.rows as unknown as CallParticipantRow[],
    recording: rec
      ? {
          id: rec.id,
          playback_url: rec.playback_url,
          duration_seconds: rec.duration_seconds,
          status: rec.status,
        }
      : null,
    transcript: tr
      ? {
          id: tr.id,
          full_text:
            buildTranscriptText(tr.segments ?? [], tr.full_text) || null,
          segments: tr.segments ?? [],
          status: tr.status,
        }
      : null,
    ai_artifact: art
      ? {
          id: art.id,
          summary: art.summary,
          key_decisions: Array.isArray(art.key_decisions)
            ? art.key_decisions
            : [],
          live_notes: art.live_notes ?? [],
          status: art.status,
        }
      : null,
    pending_review_count: parseInt(pending.rows[0]?.n ?? "0", 10),
  };
}

export async function loadCallSync(call: CallSessionRow): Promise<CallSyncPayload> {
  const participants = await query(
    `SELECT cp.*,
            COALESCE(NULLIF(TRIM(p.full_name), ''), NULLIF(TRIM(p.email), ''), 'Member') AS display_name,
            p.avatar_url
     FROM ${SCHEMA}.call_participants cp
     LEFT JOIN ${SCHEMA}.profiles p ON p.id = cp.user_id
     WHERE cp.call_session_id = $1`,
    [call.id],
  );

  return {
    id: call.id,
    status: call.status,
    metadata: (call.metadata ?? {}) as Record<string, unknown>,
    ai_enabled: call.ai_enabled,
    participants: participants.rows as unknown as CallParticipantRow[],
  };
}
