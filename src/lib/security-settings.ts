import { query, SCHEMA } from "@/lib/db";
import type { EncryptedBlob } from "@/lib/mfa/crypto";

export interface SecuritySettings {
  twoFactorEnabled: boolean;
  totpSecret?: EncryptedBlob;
  backupCodeHashes?: string[];
  pendingTotp?: EncryptedBlob & { createdAt: string };
}

type SecuritySettingsRow = {
  settings: Partial<SecuritySettings> | null;
};

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  twoFactorEnabled: false,
};

const PENDING_TTL_MS = 10 * 60 * 1000;

function mergeSettings(
  incoming?: Partial<SecuritySettings> | null,
): SecuritySettings {
  const merged = { ...DEFAULT_SECURITY_SETTINGS, ...(incoming ?? {}) };
  if (merged.pendingTotp?.createdAt) {
    const age = Date.now() - new Date(merged.pendingTotp.createdAt).getTime();
    if (age > PENDING_TTL_MS) {
      const { pendingTotp: _removed, ...rest } = merged;
      return rest;
    }
  }
  return merged;
}

export async function ensureSecuritySettingsTable(): Promise<void> {
  await query(`
        CREATE TABLE IF NOT EXISTS ${SCHEMA}.user_security_settings (
            user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
            settings JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

export async function getSecuritySettings(
  userId: string,
): Promise<SecuritySettings> {
  await ensureSecuritySettingsTable();
  const result = await query<SecuritySettingsRow>(
    `SELECT settings FROM ${SCHEMA}.user_security_settings WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return mergeSettings(result.rows[0]?.settings ?? null);
}

export async function saveSecuritySettings(
  userId: string,
  updates: Partial<SecuritySettings>,
): Promise<SecuritySettings> {
  await ensureSecuritySettingsTable();
  const current = await getSecuritySettings(userId);
  const next = mergeSettings({ ...current, ...updates });
  await query(
    `INSERT INTO ${SCHEMA}.user_security_settings (user_id, settings, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET settings = EXCLUDED.settings, updated_at = NOW()`,
    [userId, JSON.stringify(next)],
  );
  return next;
}

export function isTotpEnrolled(settings: SecuritySettings): boolean {
  return settings.twoFactorEnabled && Boolean(settings.totpSecret);
}

export function toPublicMfaStatus(
  settings: SecuritySettings,
  passkeyCount = 0,
) {
  const totp = isTotpEnrolled(settings);
  return {
    twoFactorEnabled: totp || passkeyCount > 0,
    totpEnabled: totp,
    passkeyCount,
    hasPendingSetup: Boolean(settings.pendingTotp),
    backupCodesRemaining: settings.backupCodeHashes?.length ?? 0,
  };
}
