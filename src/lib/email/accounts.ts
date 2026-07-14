import { query, SCHEMA } from "@/lib/db";
import { encryptMailboxSecret, decryptMailboxSecret } from "@/lib/email/crypto";
import { refreshGoogleAccessToken } from "@/lib/email/oauth/google";
import { refreshMicrosoftAccessToken } from "@/lib/email/oauth/microsoft";

export class MailTokenRefreshError extends Error {
  constructor(message = "Mailbox token refresh failed") {
    super(message);
    this.name = "MailTokenRefreshError";
  }
}

export type MailAuthMethod = "password" | "oauth";

export type MailAccountRow = {
  id: string;
  user_id: string;
  email_address: string;
  provider_type: "gmail" | "outlook" | "custom";
  auth_method: MailAuthMethod;
  username: string;
  encrypted_password: string;
  encrypted_refresh_token: string | null;
  token_expires_at: string | null;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  status: "connected" | "error" | "disconnected";
  quota_locked?: boolean;
  last_sync_at?: string;
  sync_cursor?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type MailAccountWithSecret = MailAccountRow & {
  decryptedPassword: string;
  decryptedRefreshToken: string | null;
};

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function ensureMailAccessTokenFresh(
  account: MailAccountWithSecret,
): Promise<MailAccountWithSecret> {
  if (account.auth_method !== "oauth") return account;

  const expMs = account.token_expires_at
    ? new Date(account.token_expires_at).getTime()
    : 0;
  if (expMs > Date.now() + TOKEN_REFRESH_BUFFER_MS) return account;
  if (!account.decryptedRefreshToken) return account;
  if (account.provider_type !== "gmail" && account.provider_type !== "outlook")
    return account;

  try {
    let access: string;
    let newRefresh: string | undefined;
    let expiresIn: number;

    if (account.provider_type === "gmail") {
      const t = await refreshGoogleAccessToken(account.decryptedRefreshToken);
      access = t.access_token;
      newRefresh = t.refresh_token;
      expiresIn = t.expires_in;
    } else {
      const t = await refreshMicrosoftAccessToken(
        account.decryptedRefreshToken,
      );
      access = t.access_token;
      newRefresh = t.refresh_token;
      expiresIn = t.expires_in;
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const encAccess = encryptMailboxSecret(access);
    const nextRefreshPlain = newRefresh ?? account.decryptedRefreshToken;
    const encRefresh = encryptMailboxSecret(nextRefreshPlain);

    await query(
      `UPDATE ${SCHEMA}.mail_accounts
             SET encrypted_password = $1,
                 encrypted_refresh_token = $2,
                 token_expires_at = $3,
                 updated_at = NOW()
             WHERE id = $4`,
      [encAccess, encRefresh, expiresAt.toISOString(), account.id],
    );

    return {
      ...account,
      encrypted_password: encAccess,
      decryptedPassword: access,
      encrypted_refresh_token: encRefresh,
      decryptedRefreshToken: nextRefreshPlain,
      token_expires_at: expiresAt.toISOString(),
    };
  } catch (error) {
    await query(
      `UPDATE ${SCHEMA}.mail_accounts
             SET status = 'error', updated_at = NOW()
             WHERE id = $1`,
      [account.id],
    );
    await createMailAuditEvent(
      account.user_id,
      account.id,
      "MAIL_TOKEN_REFRESH_FAILED",
      {
        providerType: account.provider_type,
        reason: error instanceof Error ? error.message : "Token refresh failed",
      },
    );
    throw new MailTokenRefreshError(
      error instanceof Error ? error.message : "Mailbox token refresh failed",
    );
  }
}

export async function getPrimaryMailAccount(
  userId: string,
): Promise<MailAccountRow | null> {
  const result = await query<MailAccountRow>(
    `SELECT *
         FROM ${SCHEMA}.mail_accounts
         WHERE user_id = $1
           AND status <> 'disconnected'
           AND quota_locked = false
         ORDER BY updated_at DESC
         LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    auth_method: row.auth_method || "password",
    encrypted_refresh_token: row.encrypted_refresh_token ?? null,
    token_expires_at: row.token_expires_at ?? null,
  };
}

function mailAccountRowToSecret(account: MailAccountRow): MailAccountWithSecret {
  return {
    ...account,
    decryptedPassword: decryptMailboxSecret(account.encrypted_password),
    decryptedRefreshToken: account.encrypted_refresh_token
      ? decryptMailboxSecret(account.encrypted_refresh_token)
      : null,
  };
}

export async function getMailAccountWithSecret(
  account: MailAccountRow,
): Promise<MailAccountWithSecret> {
  return ensureMailAccessTokenFresh(mailAccountRowToSecret(account));
}

export async function getPrimaryMailAccountWithSecret(
  userId: string,
): Promise<MailAccountWithSecret | null> {
  const account = await getPrimaryMailAccount(userId);
  if (!account) return null;
  return getMailAccountWithSecret(account);
}

export async function createMailAuditEvent(
  userId: string | null,
  accountId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.mail_audit_events (user_id, account_id, action, detail)
         VALUES ($1, $2, $3, $4::jsonb)`,
    [userId, accountId, action, JSON.stringify(detail)],
  );
}
