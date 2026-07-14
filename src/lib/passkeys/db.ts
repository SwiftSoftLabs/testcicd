import { query, SCHEMA } from "@/lib/db";

export type PasskeyRow = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: string;
  device_type: string | null;
  backed_up: boolean;
  transports: string[] | null;
  friendly_name: string | null;
  created_at: string;
  last_used_at: string | null;
};

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function ensurePasskeyTables(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.user_webauthn_credentials (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      device_type VARCHAR(32),
      backed_up BOOLEAN NOT NULL DEFAULT false,
      transports JSONB,
      friendly_name VARCHAR(128),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.user_webauthn_challenges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      challenge TEXT NOT NULL,
      purpose VARCHAR(32) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function countPasskeysForUser(userId: string): Promise<number> {
  await ensurePasskeyTables();
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.user_webauthn_credentials WHERE user_id = $1`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function listPasskeysForUser(userId: string) {
  await ensurePasskeyTables();
  const result = await query<PasskeyRow>(
    `SELECT id, friendly_name, device_type, backed_up, created_at, last_used_at
     FROM ${SCHEMA}.user_webauthn_credentials WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    friendlyName: r.friendly_name,
    deviceType: r.device_type,
    backedUp: r.backed_up,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

export async function getPasskeysForUser(userId: string): Promise<PasskeyRow[]> {
  await ensurePasskeyTables();
  const result = await query<PasskeyRow>(
    `SELECT * FROM ${SCHEMA}.user_webauthn_credentials WHERE user_id = $1`,
    [userId],
  );
  return result.rows;
}

export async function getPasskeyByCredentialId(
  credentialId: string,
): Promise<PasskeyRow | null> {
  await ensurePasskeyTables();
  const result = await query<PasskeyRow>(
    `SELECT * FROM ${SCHEMA}.user_webauthn_credentials WHERE credential_id = $1 LIMIT 1`,
    [credentialId],
  );
  return result.rows[0] ?? null;
}

export async function savePasskeyCredential(input: {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceType?: string;
  backedUp?: boolean;
  transports?: string[];
  friendlyName?: string;
}): Promise<void> {
  await ensurePasskeyTables();
  await query(
    `INSERT INTO ${SCHEMA}.user_webauthn_credentials (
       user_id, credential_id, public_key, counter, device_type, backed_up, transports, friendly_name
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      input.userId,
      input.credentialId,
      input.publicKey,
      input.counter,
      input.deviceType ?? null,
      input.backedUp ?? false,
      input.transports ? JSON.stringify(input.transports) : null,
      input.friendlyName ?? null,
    ],
  );
}

export async function updatePasskeyCounter(
  credentialId: string,
  counter: number,
): Promise<void> {
  await ensurePasskeyTables();
  await query(
    `UPDATE ${SCHEMA}.user_webauthn_credentials SET counter = $2, last_used_at = NOW() WHERE credential_id = $1`,
    [credentialId, counter],
  );
}

export async function deletePasskeyForUser(
  userId: string,
  passkeyId: string,
): Promise<boolean> {
  await ensurePasskeyTables();
  const result = await query(
    `DELETE FROM ${SCHEMA}.user_webauthn_credentials WHERE id = $1 AND user_id = $2`,
    [passkeyId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteAllPasskeysForUser(userId: string): Promise<void> {
  await ensurePasskeyTables();
  await query(
    `DELETE FROM ${SCHEMA}.user_webauthn_credentials WHERE user_id = $1`,
    [userId],
  );
}

export async function saveWebAuthnChallenge(input: {
  userId: string | null;
  challenge: string;
  purpose: "registration" | "authentication" | "login";
}): Promise<void> {
  await ensurePasskeyTables();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  await query(
    `DELETE FROM ${SCHEMA}.user_webauthn_challenges
     WHERE user_id IS NOT DISTINCT FROM $1::uuid AND purpose = $2`,
    [input.userId, input.purpose],
  );
  await query(
    `INSERT INTO ${SCHEMA}.user_webauthn_challenges (user_id, challenge, purpose, expires_at)
     VALUES ($1::uuid, $2, $3, $4::timestamptz)`,
    [input.userId, input.challenge, input.purpose, expiresAt],
  );
}

export async function consumeWebAuthnChallenge(input: {
  userId: string | null;
  purpose: "registration" | "authentication" | "login";
  challenge: string;
}): Promise<boolean> {
  await ensurePasskeyTables();
  const result = await query(
    `DELETE FROM ${SCHEMA}.user_webauthn_challenges
     WHERE user_id IS NOT DISTINCT FROM $1::uuid AND purpose = $2 AND challenge = $3 AND expires_at > NOW()
     RETURNING challenge`,
    [input.userId, input.purpose, input.challenge],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT id FROM auth.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email.trim()],
  );
  return result.rows[0]?.id ?? null;
}
