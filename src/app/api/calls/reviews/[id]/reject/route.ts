import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: reviewId } = await params;

  const reviewRes = await query<{
    task_id: string;
    workspace_id: string;
  }>(
    `SELECT mtr.task_id, cs.workspace_id
     FROM ${SCHEMA}.meeting_task_reviews mtr
     JOIN ${SCHEMA}.call_sessions cs ON cs.id = mtr.call_session_id
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

  await query(
    `UPDATE ${SCHEMA}.meeting_task_reviews
     SET review_status = 'rejected', reviewed_by = $2, reviewed_at = NOW()
     WHERE id = $1`,
    [reviewId, user.id],
  );

  await query(`DELETE FROM ${SCHEMA}.tasks WHERE id = $1`, [row.task_id]);

  return NextResponse.json({ ok: true });
}
