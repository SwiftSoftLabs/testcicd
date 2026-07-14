import { NextResponse } from "next/server";
import { query, SCHEMA } from "@/lib/db";
import { requireSessionUser } from "@/lib/rbac/workspace-access";
import { toAccessResponse } from "@/lib/rbac/http";
import { getPrimaryMailAccount } from "@/lib/email/accounts";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();

    const account = await getPrimaryMailAccount(user.id);
    if (!account) return NextResponse.json({ data: [] });

    const result = await query<{ id: string; subject: string; text_body: string | null }>(
      `SELECT id, subject, LEFT(COALESCE(text_body, ''), 100) AS text_body
       FROM ${SCHEMA}.mail_messages
       WHERE account_id = $1
         AND ($2 = '' OR subject ILIKE '%' || $2 || '%')
       ORDER BY received_at DESC LIMIT 8`,
      [account.id, q],
    );

    const data = result.rows.map((r) => ({
      email_id: r.id,
      email_subject: r.subject,
      email_preview: r.text_body ?? "",
    }));

    return NextResponse.json({ data });
  } catch (e: unknown) {
    const r = toAccessResponse(e);
    if (r) return r;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
