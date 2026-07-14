import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await query<{
    id: string;
    email_address: string;
    provider_type: string;
    status: string;
    quota_locked: boolean;
    last_sync_at: string | null;
    created_at: string;
    sync_cursor: Record<string, unknown> | null;
  }>(
    `SELECT id, email_address, provider_type, status, quota_locked, last_sync_at, created_at, sync_cursor
         FROM ${SCHEMA}.mail_accounts
         WHERE user_id = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
    [user.id],
  );

  const account = result.rows[0];

  let unreadCount = 0;
  if (account && account.status !== "disconnected") {
    const unreadRes = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM ${SCHEMA}.mail_messages
         WHERE account_id = $1
           AND folder = 'inbox'
           AND is_draft = false
           AND is_read = false
           AND (snoozed_until IS NULL OR snoozed_until <= NOW())`,
      [account.id],
    );
    unreadCount = unreadRes.rows[0]?.count ?? 0;
  } else {
    const unreadRes = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM ${SCHEMA}.emails
         WHERE recipient_id = $1
           AND is_archived = false
           AND is_draft = false
           AND is_read = false
           AND (snoozed_until IS NULL OR snoozed_until <= NOW())`,
      [user.id],
    );
    unreadCount = unreadRes.rows[0]?.count ?? 0;
  }

  if (!account) {
    return NextResponse.json({ connected: false, account: null, unreadCount });
  }
  if (account.status === "disconnected") {
    return NextResponse.json({ connected: false, account: null, unreadCount });
  }

  const stats = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
         FROM ${SCHEMA}.mail_messages
         WHERE account_id = $1`,
    [account.id],
  );

  const reconnectRequired =
    account.status === "error" &&
    account.sync_cursor?.reconnectRequired === true;

  return NextResponse.json({
    connected: true,
    unreadCount,
    account: {
      id: account.id,
      emailAddress: account.email_address,
      providerType: account.provider_type,
      status: account.status,
      quota_locked: account.quota_locked,
      lastSyncAt: account.last_sync_at,
      syncedMessages: stats.rows[0]?.count || 0,
      connectedAt: account.created_at,
      reconnectRequired,
    },
  });
}
