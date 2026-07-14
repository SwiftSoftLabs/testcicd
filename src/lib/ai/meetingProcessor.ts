import {
  buildMeetingContextBundle,
  formatContextForPrompt,
} from "@/lib/ai/meetingContext";
import {
  isOpenRouterMeetingAiConfigured,
  mapOpenRouterClientError,
} from "@/lib/ai/openRouterChat";
import { summarizeTranscriptWithMeetingAi } from "@/lib/calls/liveMeetingAiClient";
import { createDraftMeetingTask } from "@/lib/ai/meetingTools";
import { notifyCallParticipants } from "@/lib/calls/notifications";
import { TRANSCRIPT_PLACEHOLDER } from "@/lib/calls/transcribeRecording";
import { query, SCHEMA } from "@/lib/db";
import type { CallSessionRow, TranscriptSegment } from "@/types/calls";

export interface MeetingAiOutput {
  summary: string;
  keyDecisions: string[];
  actionItems: Array<{
    title: string;
    description: string;
    suggestedAssigneeId: string | null;
    suggestedPriority: "urgent" | "high" | "medium" | "low";
    suggestedDueDate: string | null;
    confidence: number;
  }>;
  referencedTaskIds: string[];
  risks: string[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function actionItemsFromRaw(raw: Record<string, unknown>): MeetingAiOutput["actionItems"] {
  const list = Array.isArray(raw.actionItems)
    ? raw.actionItems
    : Array.isArray(raw.action_items)
      ? raw.action_items
      : [];
  return list
    .filter((x): x is Record<string, unknown> => x && typeof x === "object")
    .map((a) => {
      const assignee =
        typeof a.suggestedAssigneeId === "string"
          ? a.suggestedAssigneeId
          : typeof a.suggested_assignee_id === "string"
            ? a.suggested_assignee_id
            : null;
      const priorityRaw = a.suggestedPriority ?? a.suggested_priority;
      return {
        title: String(a.title ?? "").slice(0, 500),
        description: String(a.description ?? "").slice(0, 2000),
        suggestedAssigneeId:
          assignee && UUID_RE.test(assignee) ? assignee : null,
        suggestedPriority: (
          ["urgent", "high", "medium", "low"] as const
        ).includes(priorityRaw as "urgent")
          ? (priorityRaw as "urgent" | "high" | "medium" | "low")
          : "medium",
        suggestedDueDate:
          typeof a.suggestedDueDate === "string"
            ? a.suggestedDueDate
            : typeof a.suggested_due_date === "string"
              ? a.suggested_due_date
              : null,
        confidence: typeof a.confidence === "number" ? a.confidence : 0.5,
      };
    })
    .filter((a) => a.title.length > 0);
}

export function parseMeetingJson(text: string): MeetingAiOutput | null {
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }
  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>;
    const summary =
      typeof raw.summary === "string" ? raw.summary.trim().slice(0, 1200) : "";
    const keyDecisions = Array.isArray(raw.keyDecisions)
      ? raw.keyDecisions.filter((x): x is string => typeof x === "string")
      : Array.isArray(raw.key_decisions)
        ? raw.key_decisions.filter((x): x is string => typeof x === "string")
        : [];
    const risks = Array.isArray(raw.risks)
      ? raw.risks.filter((x): x is string => typeof x === "string")
      : [];
    const actionItems = actionItemsFromRaw(raw);
    const referencedTaskIds = Array.isArray(raw.referencedTaskIds)
      ? raw.referencedTaskIds.filter((x): x is string => typeof x === "string")
      : Array.isArray(raw.referenced_task_ids)
        ? raw.referenced_task_ids.filter((x): x is string => typeof x === "string")
        : [];
    if (!summary && actionItems.length === 0 && keyDecisions.length === 0) {
      return null;
    }
    return {
      summary: summary || "Meeting in progress.",
      keyDecisions,
      actionItems,
      referencedTaskIds,
      risks,
    };
  } catch {
    return null;
  }
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

export async function processCallAi(callId: string): Promise<void> {
  const callRes = await query<CallSessionRow>(
    `SELECT * FROM ${SCHEMA}.call_sessions WHERE id = $1 LIMIT 1`,
    [callId],
  );
  const call = callRes.rows[0];
  if (!call) throw new Error("Call not found");

  const transcriptRes = await query<{
    full_text: string | null;
    segments: TranscriptSegment[];
  }>(
    `SELECT full_text, segments FROM ${SCHEMA}.call_transcripts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const transcript = transcriptRes.rows[0];
  const rawFull =
    transcript?.full_text ??
    (transcript?.segments ?? []).map((s) => s.text).join("\n");
  const fullText =
    rawFull === TRANSCRIPT_PLACEHOLDER || rawFull.trim() === "" ? "" : rawFull;

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
    await query(
      `INSERT INTO ${SCHEMA}.call_ai_artifacts
       (call_session_id, status)
       VALUES ($1, 'failed')`,
      [callId],
    );
    await query(
      `UPDATE ${SCHEMA}.call_sessions SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [callId],
    );
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const participantsRes = await query<{ user_id: string }>(
    `SELECT user_id FROM ${SCHEMA}.call_participants WHERE call_session_id = $1`,
    [callId],
  );
  const participantIds = participantsRes.rows.map((p) => p.user_id);
  const bundle = await buildMeetingContextBundle(call, participantIds);
  const contextText = formatContextForPrompt(bundle);

  let parsed: MeetingAiOutput | null = null;
  let modelId = "";
  try {
    const result = await summarizeTranscriptWithMeetingAi(
      fullText || "(empty transcript)",
      contextText,
    );
    parsed = result.output;
    modelId = result.modelId;
  } catch (e: unknown) {
    const { message } = mapOpenRouterClientError(e);
    await query(
      `INSERT INTO ${SCHEMA}.call_ai_artifacts
       (call_session_id, status, raw_response)
       VALUES ($1, 'failed', $2::jsonb)`,
      [callId, JSON.stringify({ error: message })],
    );
    await query(
      `UPDATE ${SCHEMA}.call_sessions SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [callId],
    );
    throw new Error(message);
  }

  if (!parsed) {
    await query(
      `INSERT INTO ${SCHEMA}.call_ai_artifacts (call_session_id, status) VALUES ($1, 'failed')`,
      [callId],
    );
    throw new Error("Could not parse AI response");
  }

  const existing = await existingTaskTitles(callId);
  let newTaskCount = 0;

  for (const item of parsed.actionItems) {
    if (isDuplicateTitle(item.title, existing)) continue;
    await createDraftMeetingTask(call, item, call.created_by);
    existing.push(item.title.toLowerCase());
    newTaskCount++;
  }

  await query(
    `INSERT INTO ${SCHEMA}.call_ai_artifacts
     (call_session_id, summary, key_decisions, raw_response, model_id, status)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, 'ready')`,
    [
      callId,
      parsed.summary,
      JSON.stringify(parsed.keyDecisions),
      JSON.stringify(parsed),
      modelId,
    ],
  );

  await query(
    `UPDATE ${SCHEMA}.call_sessions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
    [callId],
  );

  if (newTaskCount > 0) {
    await notifyCallParticipants(
      [call.created_by],
      "Meeting tasks ready for review",
      `${newTaskCount} task(s) from your meeting are pending review.`,
      "meeting_tasks_review",
      callId,
      "callMeetingTasksReview",
    );
  }

  if (call.calendar_event_id) {
    await query(
      `UPDATE ${SCHEMA}.events
       SET description = COALESCE(description, '') || E'\n\n--- OneWork AI summary ---\n' || $2,
           updated_at = NOW()
       WHERE id = $1`,
      [call.calendar_event_id, parsed.summary],
    );
  }
}
