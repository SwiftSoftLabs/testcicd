import { query, SCHEMA } from "@/lib/db";
import { isCallAiEnabled } from "@/lib/calls/constants";
import { isOpenRouterMeetingAiConfigured } from "@/lib/ai/openRouterChat";
import { buildTranscriptText } from "@/lib/calls/transcriptSegments";
import {
  fullTextFromSegments,
  upsertTranscriptSegment,
} from "@/lib/calls/transcriptSegments";
import type {
  CallAiArtifactStatus,
  CallLivePayload,
  CallTranscriptStatus,
  LiveNote,
  MeetingTaskReviewRow,
  TranscriptSegment,
} from "@/types/calls";

export async function ensureLiveAiSession(callId: string): Promise<void> {
  const tr = await query<{ id: string }>(
    `SELECT id FROM ${SCHEMA}.call_transcripts
     WHERE call_session_id = $1 LIMIT 1`,
    [callId],
  );
  if (!tr.rows[0]) {
    await query(
      `INSERT INTO ${SCHEMA}.call_transcripts (call_session_id, status, segments)
       VALUES ($1, 'processing', '[]'::jsonb)`,
      [callId],
    );
  }

  const art = await query<{ id: string }>(
    `SELECT id FROM ${SCHEMA}.call_ai_artifacts
     WHERE call_session_id = $1 LIMIT 1`,
    [callId],
  );
  if (!art.rows[0]) {
    await query(
      `INSERT INTO ${SCHEMA}.call_ai_artifacts
       (call_session_id, status, live_notes, key_decisions)
       VALUES ($1, 'processing', '[]'::jsonb, '[]'::jsonb)`,
      [callId],
    );
  }
}

export async function appendTranscriptSegment(
  callId: string,
  segment: TranscriptSegment,
): Promise<void> {
  const existing = await query<{
    id: string;
    segments: TranscriptSegment[];
    full_text: string | null;
  }>(
    `SELECT id, segments, full_text FROM ${SCHEMA}.call_transcripts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const row = existing.rows[0];
  const segments = upsertTranscriptSegment(row?.segments ?? [], segment);
  const fullText = fullTextFromSegments(segments);

  if (row) {
    await query(
      `UPDATE ${SCHEMA}.call_transcripts
       SET segments = $2::jsonb, full_text = $3, updated_at = NOW()
       WHERE id = $1`,
      [row.id, JSON.stringify(segments), fullText || null],
    );
  } else {
    await query(
      `INSERT INTO ${SCHEMA}.call_transcripts
       (call_session_id, segments, full_text, status)
       VALUES ($1, $2::jsonb, $3, 'processing')`,
      [callId, JSON.stringify([segment]), fullText || null],
    );
  }
}

export async function hasLiveTranscriptContent(
  callId: string,
): Promise<boolean> {
  const res = await query<{
    full_text: string | null;
    segments: TranscriptSegment[];
  }>(
    `SELECT full_text, segments FROM ${SCHEMA}.call_transcripts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const row = res.rows[0];
  if (!row) return false;
  if (row.full_text?.trim()) return true;
  const segs = row.segments ?? [];
  return segs.some((s) => s.text?.trim());
}

export type LoadCallLiveOptions = {
  includeTranscript?: boolean;
  agentDispatchId?: string | null;
};

export async function loadCallLivePayload(
  callId: string,
  metadata: Record<string, unknown>,
  callAiEnabled = true,
  opts: LoadCallLiveOptions = {},
): Promise<CallLivePayload> {
  const includeTranscript = opts.includeTranscript !== false;

  let tr:
    | {
        id: string;
        full_text: string | null;
        segments: TranscriptSegment[];
        status: string;
      }
    | undefined;

  if (includeTranscript) {
    const transcriptRes = await query<{
      id: string;
      full_text: string | null;
      segments: TranscriptSegment[];
      status: string;
    }>(
      `SELECT id, full_text, segments, status FROM ${SCHEMA}.call_transcripts
       WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [callId],
    );
    tr = transcriptRes.rows[0];
  }

  let hasTranscriptLite = false;
  if (!includeTranscript) {
    const existsRes = await query<{ ok: number }>(
      `SELECT 1 AS ok FROM ${SCHEMA}.call_transcripts
       WHERE call_session_id = $1
         AND (
           (full_text IS NOT NULL AND btrim(full_text) <> '')
           OR COALESCE(jsonb_array_length(segments), 0) > 0
         )
       LIMIT 1`,
      [callId],
    );
    hasTranscriptLite = existsRes.rows.length > 0;
  }

  const artRes = await query<{
    id: string;
    summary: string | null;
    key_decisions: string[];
    live_notes: LiveNote[];
    status: string;
  }>(
    `SELECT id, summary, key_decisions, live_notes, status
     FROM ${SCHEMA}.call_ai_artifacts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const art = artRes.rows[0];

  const reviewsRes = await query(
    `SELECT mtr.*,
            t.id AS task_id, t.title, t.description, t.status, t.tags, t.assignee_id
     FROM ${SCHEMA}.meeting_task_reviews mtr
     JOIN ${SCHEMA}.tasks t ON t.id = mtr.task_id
     WHERE mtr.call_session_id = $1
       AND mtr.review_status IN ('pending', 'acknowledged')
     ORDER BY mtr.created_at DESC`,
    [callId],
  );

  const reviews: MeetingTaskReviewRow[] = reviewsRes.rows.map(
    (r: Record<string, unknown>) => ({
      id: r.id as string,
      call_session_id: r.call_session_id as string,
      task_id: r.task_id as string,
      review_status: r.review_status as MeetingTaskReviewRow["review_status"],
      reviewed_by: (r.reviewed_by as string | null) ?? null,
      reviewed_at: (r.reviewed_at as string | null) ?? null,
      ai_confidence: r.ai_confidence as number | null,
      created_at: r.created_at as string,
      task: {
        id: r.task_id as string,
        title: r.title as string,
        description: (r.description as string | null) ?? null,
        status: r.status as string,
        tags: (r.tags as string[]) ?? [],
        assignee_id: (r.assignee_id as string | null) ?? null,
      },
    }),
  );

  const agentDispatchId = opts.agentDispatchId ?? null;

  const sttError =
    typeof metadata.agent_error === "string"
      ? metadata.agent_error
      : typeof metadata.stt_error === "string"
        ? metadata.stt_error
        : null;
  const lastAiRunAt =
    typeof metadata.last_live_ai_at === "string"
      ? metadata.last_live_ai_at
      : null;
  const liveAiRunning = metadata.live_ai_running === true;
  const transcriptText = tr
    ? buildTranscriptText(tr.segments ?? [], tr.full_text)
    : "";
  const hasTranscript = includeTranscript
    ? transcriptText.trim().length > 0
    : hasTranscriptLite;

  let tasksPipelineStage: "idle" | "hearing" | "compiling" | "creating" | "ready" =
    "idle";
  if (hasTranscript) {
    if (reviews.length > 0) {
      tasksPipelineStage = "ready";
    } else if (liveAiRunning) {
      tasksPipelineStage = "creating";
    } else if (lastAiRunAt) {
      tasksPipelineStage = "compiling";
    } else {
      tasksPipelineStage = "hearing";
    }
  }

  return {
    transcript:
      includeTranscript && tr
        ? {
            id: tr.id,
            full_text: tr.full_text,
            segments: tr.segments ?? [],
            status: tr.status as CallTranscriptStatus,
          }
        : null,
    artifact: art
      ? {
          id: art.id,
          summary: art.summary,
          key_decisions: Array.isArray(art.key_decisions)
            ? art.key_decisions
            : [],
          live_notes: Array.isArray(art.live_notes) ? art.live_notes : [],
          status: art.status as CallAiArtifactStatus,
        }
      : null,
    reviews,
    stt_status: {
      envEnabled: isCallAiEnabled(),
      agentDispatchId,
      error: sttError,
      aiEnabled: callAiEnabled && isCallAiEnabled(),
    },
    ai_status: {
      geminiConfigured: isOpenRouterMeetingAiConfigured(),
      artifactStatus: art?.status
        ? (art.status as CallAiArtifactStatus)
        : null,
      pendingTaskCount: reviews.length,
      lastAiRunAt,
      liveAiRunning,
      tasksPipelineStage,
    },
  };
}
