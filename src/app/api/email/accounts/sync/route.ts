import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import {
  getPrimaryMailAccountWithSecret,
  createMailAuditEvent,
} from "@/lib/email/accounts";
import { runMailboxSync } from "@/lib/email/sync";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";
import { ensureEmailAccountScopedSchema } from "@/lib/email/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rate = checkSimpleRateLimit(`mail-sync:${user.id}`, 5, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many sync requests. Please retry." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rate.retryAfterMs || 0) / 1000)),
        },
      },
    );
  }

  await request.json().catch(() => null);

  const account = await getPrimaryMailAccountWithSecret(user.id);
  if (!account)
    return NextResponse.json(
      { error: "No connected mailbox account" },
      { status: 404 },
    );

  try {
    await ensureEmailAccountScopedSchema();
    const result = await runMailboxSync(account, null, "manual");
    await createMailAuditEvent(user.id, account.id, "MAIL_SYNC_SUCCESS", {
      synced: result.synced,
    });
    return NextResponse.json({ ok: true, synced: result.synced });
  } catch (error) {
    await createMailAuditEvent(user.id, account.id, "MAIL_SYNC_FAILED", {
      reason: error instanceof Error ? error.message : "Unknown sync failure",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mailbox sync failed" },
      { status: 500 },
    );
  }
}
