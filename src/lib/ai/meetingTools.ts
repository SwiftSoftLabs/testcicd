import { query, SCHEMA } from "@/lib/db";
import { insertTask } from "@/lib/tasks/insertTask";
import {
  buildMeetingContextBundle,
  formatContextForPrompt,
} from "@/lib/ai/meetingContext";
import type { CallSessionRow } from "@/types/calls";

export interface DraftTaskInput {
  title: string;
  description?: string;
  suggestedAssigneeId?: string | null;
  suggestedPriority?: "urgent" | "high" | "medium" | "low";
  suggestedDueDate?: string | null;
  confidence?: number;
}

export async function getWorkspaceContextText(
  call: CallSessionRow,
  participantIds: string[],
): Promise<string> {
  const bundle = await buildMeetingContextBundle(call, participantIds);
  return formatContextForPrompt(bundle);
}

export async function createDraftMeetingTask(
  call: CallSessionRow,
  input: DraftTaskInput,
  hostId: string,
): Promise<{ taskId: string; reviewId: string }> {
  const tags = ["meeting-ai", "pending-review"];
  const created = await insertTask({
    workspace_id: call.workspace_id,
    project_id: call.project_id,
    title: input.title.slice(0, 500),
    description: input.description?.slice(0, 5000) ?? "",
    status: "backlog",
    priority: input.suggestedPriority ?? "medium",
    assignee_id: input.suggestedAssigneeId ?? hostId,
    tags,
    source_call_id: call.id,
    due_date: input.suggestedDueDate ?? null,
  });

  const taskId = created.id as string | undefined;
  if (!taskId) throw new Error("Failed to create task");

  const reviewRes = await query<{ id: string }>(
    `INSERT INTO ${SCHEMA}.meeting_task_reviews
     (call_session_id, task_id, review_status, ai_confidence)
     VALUES ($1, $2, 'pending', $3)
     ON CONFLICT (call_session_id, task_id) DO UPDATE SET review_status = 'pending'
     RETURNING id`,
    [call.id, taskId, input.confidence ?? null],
  );

  try {
    await query(
      `INSERT INTO ${SCHEMA}.task_activities (task_id, user_id, type, content)
       VALUES ($1, $2, 'comment', $3)`,
      [
        taskId,
        hostId,
        `Suggested from meeting "${call.title}" (pending review).`,
      ],
    );
  } catch {
    /* Activity log is optional; task + review are the source of truth. */
  }

  return { taskId, reviewId: reviewRes.rows[0]?.id ?? "" };
}
