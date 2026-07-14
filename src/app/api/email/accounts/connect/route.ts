import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import {
  resolveProviderPreset,
  providerPresetByType,
  MailProviderType,
} from "@/lib/email/providers/profiles";
import { encryptMailboxSecret } from "@/lib/email/crypto";
import { createMailAuditEvent } from "@/lib/email/accounts";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";
import { checkInboxLimit } from "@/lib/billing/enforce";

export const runtime = "nodejs";

type ConnectPayload = {
  workspaceId?: string;
  emailAddress?: string;
  username?: string;
  password?: string;
  providerType?: MailProviderType;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
};

type ParsedConnectPayload = Omit<Required<ConnectPayload>, "workspaceId"> & {
  workspaceId?: string;
};

async function safeCreateAuditEvent(
  userId: string | null,
  accountId: string | null,
  action: string,
  detail: Record<string, unknown>,
) {
  try {
    await createMailAuditEvent(userId, accountId, action, detail);
  } catch {
    // Do not fail mailbox connect because audit table/migration is missing.
  }
}

function parsePayload(raw: unknown): {
  data?: ParsedConnectPayload;
  error?: string;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { error: "Invalid payload" };
  const body = raw as ConnectPayload;
  const emailAddress = body.emailAddress?.trim().toLowerCase();
  const username = body.username?.trim();
  const password = body.password || "";
  if (!emailAddress || !username || !password) {
    return { error: "emailAddress, username and password are required" };
  }

  let providerType = body.providerType;
  let resolved = providerType
    ? providerPresetByType(providerType)
    : resolveProviderPreset(emailAddress);
  if (!providerType) providerType = resolved?.providerType || "custom";

  if (providerType === "custom") {
    if (!body.imapHost || !body.imapPort || !body.smtpHost || !body.smtpPort) {
      return { error: "Custom provider requires IMAP/SMTP host and port" };
    }
    resolved = {
      providerType: "custom",
      label: "Custom",
      imapHost: body.imapHost.trim(),
      imapPort: Number(body.imapPort),
      imapSecure: body.imapSecure ?? true,
      smtpHost: body.smtpHost.trim(),
      smtpPort: Number(body.smtpPort),
      smtpSecure: body.smtpSecure ?? true,
    };
  }
  if (!resolved) return { error: "Could not resolve provider settings" };

  if (providerType === "gmail" || providerType === "outlook") {
    return {
      error:
        "Gmail and Outlook must be connected using Sign in with Google or Microsoft.",
    };
  }

  return {
    data: {
      emailAddress,
      username,
      password,
      providerType,
      imapHost: resolved.imapHost,
      imapPort: resolved.imapPort,
      imapSecure: resolved.imapSecure,
      smtpHost: resolved.smtpHost,
      smtpPort: resolved.smtpPort,
      smtpSecure: resolved.smtpSecure,
    },
  };
}

export async function POST(request: Request) {
  let userId: string | null = null;
  try {
    const user = await getUserFromRequest(request);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    userId = user.id;

    const rate = checkSimpleRateLimit(`mail-connect:${user.id}`, 10, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many connect attempts. Please retry." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rate.retryAfterMs || 0) / 1000)),
          },
        },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = parsePayload(body);
    if (parsed.error)
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    const data = parsed.data!;

    if (data.workspaceId) {
      const inboxCheck = await checkInboxLimit(data.workspaceId, user.id);
      if (!inboxCheck.allowed) {
        return NextResponse.json({ error: inboxCheck.error, code: inboxCheck.code }, { status: 403 });
      }
    }

    const encryptedPassword = encryptMailboxSecret(data.password);

    const upsertRes = await query<{
      id: string;
      provider_type: string;
      last_sync_at: string | null;
    }>(
      `INSERT INTO ${SCHEMA}.mail_accounts (
                user_id, email_address, provider_type, auth_method, username,
                encrypted_password, encrypted_refresh_token, token_expires_at,
                imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, status, sync_cursor
             ) VALUES (
                $1, $2, $3, 'password', $4, $5, NULL, NULL,
                $6, $7, $8, $9, $10, $11, 'connected', '{}'::jsonb
             )
             ON CONFLICT (user_id, email_address)
             DO UPDATE SET
                provider_type = EXCLUDED.provider_type,
                auth_method = 'password',
                username = EXCLUDED.username,
                encrypted_password = EXCLUDED.encrypted_password,
                encrypted_refresh_token = NULL,
                token_expires_at = NULL,
                imap_host = EXCLUDED.imap_host,
                imap_port = EXCLUDED.imap_port,
                imap_secure = EXCLUDED.imap_secure,
                smtp_host = EXCLUDED.smtp_host,
                smtp_port = EXCLUDED.smtp_port,
                smtp_secure = EXCLUDED.smtp_secure,
                status = 'connected',
                updated_at = NOW()
             RETURNING id, provider_type, last_sync_at`,
      [
        user.id,
        data.emailAddress,
        data.providerType,
        data.username,
        encryptedPassword,
        data.imapHost,
        data.imapPort,
        data.imapSecure,
        data.smtpHost,
        data.smtpPort,
        data.smtpSecure,
      ],
    );

    const accountId = upsertRes.rows[0]?.id || null;
    await safeCreateAuditEvent(user.id, accountId, "MAIL_ACCOUNT_CONNECTED", {
      emailAddress: data.emailAddress,
      providerType: data.providerType,
    });

    return NextResponse.json({
      ok: true,
      accountId,
      providerType: upsertRes.rows[0]?.provider_type || data.providerType,
      lastSyncAt: upsertRes.rows[0]?.last_sync_at || null,
    });
  } catch (error) {
    await safeCreateAuditEvent(userId, null, "MAIL_ACCOUNT_CONNECT_FAILED", {
      reason:
        error instanceof Error ? error.message : "Unknown connect failure",
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not connect mailbox",
      },
      { status: 400 },
    );
  }
}
