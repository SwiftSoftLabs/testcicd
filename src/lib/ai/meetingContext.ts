import { query, SCHEMA } from "@/lib/db";
import type { CallSessionRow } from "@/types/calls";

export interface MeetingContextBundle {
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    assignee_id: string | null;
  }>;
  calendar: Array<{
    id: string;
    title: string;
    start_time: string;
    end_time: string;
  }>;
  chat: Array<{
    sender_id: string;
    content: string;
    created_at: string;
  }>;
}

export async function buildMeetingContextBundle(
  call: CallSessionRow,
  _participantIds: string[],
): Promise<MeetingContextBundle> {
  const projectFilter = call.project_id ? `AND project_id = $2` : "";
  const taskParams = call.project_id
    ? [call.workspace_id, call.project_id]
    : [call.workspace_id];

  const tasksRes = await query<MeetingContextBundle["tasks"][0]>(
    `SELECT id, title, status, priority, assignee_id
     FROM ${SCHEMA}.tasks
     WHERE workspace_id = $1
       AND status IN ('backlog', 'todo', 'in-progress', 'review')
       ${projectFilter}
     ORDER BY updated_at DESC
     LIMIT 30`,
    taskParams,
  );

  const calRes = await query<MeetingContextBundle["calendar"][0]>(
    `SELECT id, title, start_time, end_time
     FROM ${SCHEMA}.events
     WHERE workspace_id = $1
       AND status = 'confirmed'
       AND start_time >= NOW() - INTERVAL '7 days'
       AND end_time <= NOW() + INTERVAL '7 days'
     ORDER BY start_time ASC
     LIMIT 20`,
    [call.workspace_id],
  );

  let chat: MeetingContextBundle["chat"] = [];
  if (call.conversation_id) {
    const chatRes = await query<MeetingContextBundle["chat"][0]>(
      `SELECT sender_id, content, created_at::text
       FROM ${SCHEMA}.messages
       WHERE conversation_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 50`,
      [call.conversation_id],
    );
    chat = chatRes.rows.reverse();
  }

  return {
    tasks: tasksRes.rows,
    calendar: calRes.rows,
    chat,
  };
}

export function formatContextForPrompt(bundle: MeetingContextBundle): string {
  const lines: string[] = ["## Workspace context (read-only)"];
  lines.push("### Open tasks");
  if (bundle.tasks.length === 0) lines.push("(none)");
  else {
    for (const t of bundle.tasks) {
      lines.push(`- [${t.status}] ${t.title} (id: ${t.id})`);
    }
  }
  lines.push("### Calendar (±7 days)");
  if (bundle.calendar.length === 0) lines.push("(none)");
  else {
    for (const e of bundle.calendar) {
      lines.push(`- ${e.title}: ${e.start_time} – ${e.end_time}`);
    }
  }
  if (bundle.chat.length > 0) {
    lines.push("### Recent chat (linked channel)");
    for (const m of bundle.chat.slice(-20)) {
      lines.push(`- ${m.content.slice(0, 200)}`);
    }
  }
  return lines.join("\n");
}
