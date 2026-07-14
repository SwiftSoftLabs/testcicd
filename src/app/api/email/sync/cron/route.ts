import { NextResponse } from "next/server";

import { query, SCHEMA } from "@/lib/db";
import {
  createMailAuditEvent,
  getMailAccountWithSecret,
  type MailAccountRow,
} from "@/lib/email/accounts";
import { runMailboxSync } from "@/lib/email/sync";
import { ensureEmailAccountScopedSchema } from "@/lib/email/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.MAIL_SYNC_CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureEmailAccountScopedSchema();

  const result = await query<MailAccountRow>(
    `SELECT *
         FROM ${SCHEMA}.mail_accounts
         WHERE status = 'connected'
           AND quota_locked = false
         ORDER BY last_sync_at ASC NULLS FIRST
         LIMIT 50`,
  );

  const summaries: Array<{
    accountId: string;
    emailAddress: string;
    synced?: number;
    error?: string;
  }> = [];

  for (const row of result.rows) {
    try {
      const account = await getMailAccountWithSecret({
        ...row,
        auth_method: row.auth_method || "password",
        encrypted_refresh_token: row.encrypted_refresh_token ?? null,
        token_expires_at: row.token_expires_at ?? null,
      });

      const syncResult = await runMailboxSync(account, null, "incremental");
      summaries.push({
        accountId: account.id,
        emailAddress: account.email_address,
        synced: syncResult.synced,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Mailbox sync failed";
      summaries.push({
        accountId: row.id,
        emailAddress: row.email_address,
        error: message,
      });
      await createMailAuditEvent(row.user_id, row.id, "MAIL_CRON_SYNC_FAILED", {
        reason: message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    synced: summaries.filter((s) => !s.error).length,
    results: summaries,
  });
}
