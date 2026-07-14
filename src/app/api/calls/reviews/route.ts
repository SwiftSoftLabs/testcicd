import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { assertWorkspaceMember } from "@/lib/calls/access";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const callSessionId = url.searchParams.get("callSessionId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "5", 10) || 5, 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;

  if (callSessionId) {
    const callRes = await query<{ workspace_id: string }>(
      `SELECT workspace_id FROM ${SCHEMA}.call_sessions WHERE id = $1 LIMIT 1`,
      [callSessionId],
    );
    const wsId = callRes.rows[0]?.workspace_id;
    if (!wsId || !(await assertWorkspaceMember(wsId, user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const res = await query(
      `SELECT mtr.*,
              t.id AS task_id, t.title, t.description, t.status, t.tags, t.assignee_id,
              cs.id AS call_id, cs.title AS call_title, cs.started_at
       FROM ${SCHEMA}.meeting_task_reviews mtr
       JOIN ${SCHEMA}.tasks t ON t.id = mtr.task_id
       JOIN ${SCHEMA}.call_sessions cs ON cs.id = mtr.call_session_id
       WHERE mtr.call_session_id = $1
         AND mtr.review_status IN ('pending', 'acknowledged')
       ORDER BY mtr.created_at DESC
       LIMIT $2 OFFSET $3`,
      [callSessionId, limit, offset],
    );
    const rows = res.rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      call_session_id: r.call_session_id,
      task_id: r.task_id,
      review_status: r.review_status,
      ai_confidence: r.ai_confidence,
      created_at: r.created_at,
      task: {
        id: r.task_id,
        title: r.title,
        description: r.description,
        status: r.status,
        tags: r.tags,
        assignee_id: r.assignee_id,
      },
      call: {
        id: r.call_id,
        title: r.call_title,
        started_at: r.started_at,
      },
    }));
    return NextResponse.json(rows);
  }

  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId or callSessionId is required" },
      { status: 400 },
    );
  }

  if (!(await assertWorkspaceMember(workspaceId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const res = await query(
    `SELECT mtr.*,
            t.id AS task_id, t.title, t.description, t.status, t.tags, t.assignee_id,
            cs.id AS call_id, cs.title AS call_title, cs.started_at
     FROM ${SCHEMA}.meeting_task_reviews mtr
     JOIN ${SCHEMA}.tasks t ON t.id = mtr.task_id
     JOIN ${SCHEMA}.call_sessions cs ON cs.id = mtr.call_session_id
     WHERE cs.workspace_id = $1
       AND mtr.review_status IN ('pending', 'acknowledged')
     ORDER BY mtr.created_at DESC
     LIMIT $2 OFFSET $3`,
    [workspaceId, limit, offset],
  );

  const rows = res.rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    call_session_id: r.call_session_id,
    task_id: r.task_id,
    review_status: r.review_status,
    ai_confidence: r.ai_confidence,
    created_at: r.created_at,
    task: {
      id: r.task_id,
      title: r.title,
      description: r.description,
      status: r.status,
      tags: r.tags,
      assignee_id: r.assignee_id,
    },
    call: {
      id: r.call_id,
      title: r.call_title,
      started_at: r.started_at,
    },
  }));

  return NextResponse.json(rows);
}
