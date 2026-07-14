import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { canReceiveTaskNotification } from "@/lib/notification-preferences";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: reviewId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    move_to_todo?: boolean;
    /** During a call: acknowledge only; final backlog approval happens in Review tab. */
    in_call?: boolean;
  };

  const reviewRes = await query<{
    id: string;
    task_id: string;
    call_session_id: string;
    workspace_id: string;
    assignee_id: string | null;
    title: string;
    tags: string[];
    resolved_project_id: string | null;
    resolved_sprint_id: string | null;
  }>(
    `SELECT mtr.id, mtr.task_id, mtr.call_session_id, cs.workspace_id,
            t.assignee_id, t.title, t.tags,
            COALESCE(
              t.project_id,
              cs.project_id,
              (SELECT p.id FROM ${SCHEMA}.projects p
               WHERE p.workspace_id = cs.workspace_id
               ORDER BY p.created_at ASC
               LIMIT 1)
            ) AS resolved_project_id,
            COALESCE(
              t.sprint_id,
              (SELECT s.id FROM ${SCHEMA}.sprints s
               WHERE s.workspace_id = cs.workspace_id AND s.status = 'active'
                 AND (
                   COALESCE(t.project_id, cs.project_id) IS NULL
                   OR s.project_id = COALESCE(t.project_id, cs.project_id)
                   OR s.project_id IS NULL
                 )
               ORDER BY
                 CASE
                   WHEN COALESCE(t.project_id, cs.project_id) IS NOT NULL
                        AND s.project_id = COALESCE(t.project_id, cs.project_id) THEN 0
                   WHEN s.project_id IS NULL THEN 1
                   ELSE 2
                 END,
                 s.created_at DESC
               LIMIT 1)
            ) AS resolved_sprint_id
     FROM ${SCHEMA}.meeting_task_reviews mtr
     JOIN ${SCHEMA}.call_sessions cs ON cs.id = mtr.call_session_id
     JOIN ${SCHEMA}.tasks t ON t.id = mtr.task_id
     WHERE mtr.id = $1 LIMIT 1`,
    [reviewId],
  );
  const row = reviewRes.rows[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const member = await query(
    `SELECT 1 FROM ${SCHEMA}.workspace_members
     WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
    [row.workspace_id, user.id],
  );
  if (!member.rows[0])
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (body.in_call) {
    await query(
      `UPDATE ${SCHEMA}.meeting_task_reviews
       SET review_status = 'acknowledged', reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $1`,
      [reviewId, user.id],
    );
    return NextResponse.json({ ok: true, acknowledged: true });
  }

  const newTags = (row.tags ?? []).filter((t) => t !== "pending-review");
  const newStatus = body.move_to_todo ? "todo" : "backlog";

  const taskUpdate = await query<{
    id: string;
    status: string;
    tags: string[];
    sprint_id: string | null;
    project_id: string | null;
  }>(
    `UPDATE ${SCHEMA}.tasks
     SET tags = $2::text[],
         status = $3,
         project_id = COALESCE(project_id, $4),
         sprint_id = COALESCE(sprint_id, $5),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, status, tags, sprint_id, project_id`,
    [
      row.task_id,
      newTags,
      newStatus,
      row.resolved_project_id,
      row.resolved_sprint_id,
    ],
  );

  await query(
    `UPDATE ${SCHEMA}.meeting_task_reviews
     SET review_status = 'approved', reviewed_by = $2, reviewed_at = NOW()
     WHERE id = $1`,
    [reviewId, user.id],
  );

  if (row.assignee_id && row.assignee_id !== user.id) {
    const can = await canReceiveTaskNotification(
      row.assignee_id,
      "taskAssignments",
    );
    if (can) {
      await query(
        `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
         VALUES ($1, $2, $3, 'assignment', $4)`,
        [row.assignee_id, "Meeting task approved", row.title, row.task_id],
      );
    }
  }

  const updatedTask = taskUpdate.rows[0];
  return NextResponse.json({
    ok: true,
    task: updatedTask
      ? {
          id: updatedTask.id,
          status: updatedTask.status,
          tags: updatedTask.tags,
          sprint_id: updatedTask.sprint_id,
          project_id: updatedTask.project_id,
        }
      : undefined,
  });
}
