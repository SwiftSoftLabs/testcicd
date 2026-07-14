import { createDraftMeetingTask } from "@/lib/ai/meetingTools";
import { query, SCHEMA } from "@/lib/db";
import { fullTextFromSegments } from "@/lib/calls/transcriptSegments";
import type { CallSessionRow, LiveNote, TranscriptSegment } from "@/types/calls";
import type { DraftTaskInput } from "@/lib/ai/meetingTools";
import {
  PROCESSING_MILESTONES,
  setCallProcessingProgress,
} from "@/lib/calls/processingProgress";

export interface FlushLocalAiPayload {
  summary: string | null;
  keyDecisions: string[];
  liveNotes: LiveNote[];
  pendingTasks: DraftTaskInput[];
}

async function existingTaskTitles(callId: string): Promise<string[]> {
  const res = await query<{ title: string }>(
    `SELECT title FROM ${SCHEMA}.tasks WHERE source_call_id = $1`,
    [callId],
  );
  return res.rows.map((r) => r.title.toLowerCase());
}

function isDuplicateTitle(title: string, existing: string[]): boolean {
  const t = title.toLowerCase().trim();
  return existing.some((e) => e === t || e.includes(t) || t.includes(e));
}

export async function flushCallTranscriptToDb(
  call: CallSessionRow,
  segments: TranscriptSegment[],
  localAi: FlushLocalAiPayload,
): Promise<{ tasksCreated: number }> {
  const callId = call.id;
  const fullText = fullTextFromSegments(segments);

  const existing = await query<{
    id: string;
    segments: TranscriptSegment[];
  }>(
    `SELECT id, segments FROM ${SCHEMA}.call_transcripts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const row = existing.rows[0];

  if (row) {
    await query(
      `UPDATE ${SCHEMA}.call_transcripts
       SET segments = $2::jsonb, full_text = $3, updated_at = NOW()
       WHERE id = $1`,
      [row.id, JSON.stringify(segments), fullText || null],
    );
  } else if (segments.length > 0 || fullText) {
    await query(
      `INSERT INTO ${SCHEMA}.call_transcripts
       (call_session_id, segments, full_text, status)
       VALUES ($1, $2::jsonb, $3, 'processing')`,
      [callId, JSON.stringify(segments), fullText || null],
    );
  }

  const summary = localAi.summary?.trim() ?? "";
  const keyDecisions = localAi.keyDecisions ?? [];
  const liveNotes = localAi.liveNotes ?? [];

  if (summary || keyDecisions.length || liveNotes.length) {
    const artRes = await query<{ id: string }>(
      `SELECT id FROM ${SCHEMA}.call_ai_artifacts
       WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [callId],
    );
    const art = artRes.rows[0];
    if (art) {
      await query(
        `UPDATE ${SCHEMA}.call_ai_artifacts
         SET summary = $2, key_decisions = $3::jsonb, live_notes = $4::jsonb
         WHERE id = $1`,
        [
          art.id,
          summary || null,
          JSON.stringify(keyDecisions),
          JSON.stringify(liveNotes),
        ],
      );
    } else {
      await query(
        `INSERT INTO ${SCHEMA}.call_ai_artifacts
         (call_session_id, summary, key_decisions, live_notes, status)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, 'processing')`,
        [
          callId,
          summary || null,
          JSON.stringify(keyDecisions),
          JSON.stringify(liveNotes),
        ],
      );
    }
  }

  const existingTitles = await existingTaskTitles(callId);
  let tasksCreated = 0;
  const items = localAi.pendingTasks ?? [];
  for (const item of items) {
    if (!item.title?.trim()) continue;
    if (isDuplicateTitle(item.title, existingTitles)) continue;
    try {
      await createDraftMeetingTask(call, item, call.created_by);
      existingTitles.push(item.title.toLowerCase());
      tasksCreated += 1;
    } catch (e: unknown) {
      console.error("[flushLocalTranscript] createDraftMeetingTask", callId, e);
    }
  }

  await query(
    `UPDATE ${SCHEMA}.call_sessions
     SET metadata = metadata || $2::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [
      callId,
      JSON.stringify({
        local_flush_at: new Date().toISOString(),
        local_flush_segment_count: segments.length,
      }),
    ],
  );

  await setCallProcessingProgress(callId, PROCESSING_MILESTONES.savingTranscript, {
    phase: "ending",
    stepLabel: "Transcript saved",
  });

  return { tasksCreated };
}
