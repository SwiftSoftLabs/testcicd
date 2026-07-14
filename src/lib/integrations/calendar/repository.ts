import { query, SCHEMA } from "@/lib/db";
import { decryptCalendarSecret, encryptCalendarSecret } from "./crypto";
import type { CalendarIntegrationProvider } from "./oauth";

export interface CalendarIntegrationRow {
  id: string;
  user_id: string;
  provider: CalendarIntegrationProvider;
  account_email: string | null;
  account_name: string | null;
  account_id: string;
  scopes: string[];
  encrypted_token: string;
  encrypted_refresh: string | null;
  token_expires_at: string | null;
  status: "connected" | "error" | "revoked";
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarIntegrationStatus {
  provider: CalendarIntegrationProvider;
  connected: boolean;
  accountEmail: string | null;
  accountName: string | null;
  status: "connected" | "error" | "revoked" | "disconnected";
}

export interface UpsertCalendarIntegrationInput {
  userId: string;
  provider: CalendarIntegrationProvider;
  accountEmail: string | null;
  accountName: string | null;
  accountId: string;
  scopes: string[];
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}

export async function upsertCalendarIntegration(
  input: UpsertCalendarIntegrationInput,
): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.calendar_video_integrations (
            user_id, provider, account_email, account_name, account_id, scopes,
            encrypted_token, encrypted_refresh, token_expires_at, status
         ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, 'connected'
         )
         ON CONFLICT (user_id, provider)
         DO UPDATE SET
            account_email = EXCLUDED.account_email,
            account_name = EXCLUDED.account_name,
            account_id = EXCLUDED.account_id,
            scopes = EXCLUDED.scopes,
            encrypted_token = EXCLUDED.encrypted_token,
            encrypted_refresh = COALESCE(EXCLUDED.encrypted_refresh, ${SCHEMA}.calendar_video_integrations.encrypted_refresh),
            token_expires_at = EXCLUDED.token_expires_at,
            status = 'connected',
            updated_at = NOW()`,
    [
      input.userId,
      input.provider,
      input.accountEmail,
      input.accountName,
      input.accountId,
      input.scopes,
      encryptCalendarSecret(input.accessToken),
      input.refreshToken ? encryptCalendarSecret(input.refreshToken) : null,
      input.tokenExpiresAt?.toISOString() ?? null,
    ],
  );
}

export async function findCalendarIntegration(
  userId: string,
  provider: CalendarIntegrationProvider,
): Promise<CalendarIntegrationRow | null> {
  const result = await query<CalendarIntegrationRow>(
    `SELECT * FROM ${SCHEMA}.calendar_video_integrations
         WHERE user_id = $1 AND provider = $2 AND status = 'connected'
         LIMIT 1`,
    [userId, provider],
  );
  return result.rows[0] ?? null;
}

export async function getCalendarIntegrationStatuses(
  userId: string,
): Promise<CalendarIntegrationStatus[]> {
  const result = await query<CalendarIntegrationRow>(
    `SELECT * FROM ${SCHEMA}.calendar_video_integrations
         WHERE user_id = $1
           AND provider IN ('google_calendar', 'zoom')`,
    [userId],
  );
  const byProvider = new Map(result.rows.map((row) => [row.provider, row]));
  return (["google_calendar", "zoom"] as const).map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      connected: row?.status === "connected",
      accountEmail: row?.account_email ?? null,
      accountName: row?.account_name ?? null,
      status: row?.status ?? "disconnected",
    };
  });
}

export async function deleteCalendarIntegration(
  userId: string,
  provider: CalendarIntegrationProvider,
): Promise<void> {
  await query(
    `DELETE FROM ${SCHEMA}.calendar_video_integrations
         WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
}

export async function markIntegrationUsed(id: string): Promise<void> {
  await query(
    `UPDATE ${SCHEMA}.calendar_video_integrations
         SET last_used_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
    [id],
  );
}

export function decryptAccessToken(row: CalendarIntegrationRow): string {
  return decryptCalendarSecret(row.encrypted_token);
}

export function decryptRefreshToken(
  row: CalendarIntegrationRow,
): string | null {
  return row.encrypted_refresh
    ? decryptCalendarSecret(row.encrypted_refresh)
    : null;
}

export async function replaceAccessToken(
  row: CalendarIntegrationRow,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
): Promise<void> {
  await query(
    `UPDATE ${SCHEMA}.calendar_video_integrations
         SET encrypted_token = $1,
             encrypted_refresh = COALESCE($2, encrypted_refresh),
             token_expires_at = $3,
             status = 'connected',
             updated_at = NOW()
         WHERE id = $4`,
    [
      encryptCalendarSecret(accessToken),
      refreshToken ? encryptCalendarSecret(refreshToken) : null,
      expiresAt?.toISOString() ?? null,
      row.id,
    ],
  );
}
