import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { createMailAuditEvent } from "@/lib/email/accounts";
import { evaluateQuotaGrace } from "@/lib/billing/reconcile";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!id)
    return NextResponse.json(
      { error: "Account id is required" },
      { status: 400 },
    );

  try {
    const match = await query<{ id: string }>(
      `SELECT id FROM ${SCHEMA}.mail_accounts
           WHERE id = $1 AND user_id = $2
           LIMIT 1`,
      [id, user.id],
    );
    if (!match.rows[0])
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await query(
      `UPDATE ${SCHEMA}.mail_accounts
           SET status = 'disconnected', updated_at = NOW()
           WHERE id = $1`,
      [id],
    );
    await query(`DELETE FROM ${SCHEMA}.mail_messages WHERE account_id = $1`, [
      id,
    ]);
    await createMailAuditEvent(user.id, id, "MAIL_ACCOUNT_DISCONNECTED", {});

    const workspaces = await query<{ workspace_id: string }>(
      `SELECT DISTINCT workspace_id
       FROM ${SCHEMA}.workspace_members
       WHERE user_id = $1`,
      [user.id],
    );
    await Promise.all(
      workspaces.rows.map(({ workspace_id }) => evaluateQuotaGrace(workspace_id)),
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[email/accounts] DELETE error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
