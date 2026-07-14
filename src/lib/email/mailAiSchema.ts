import { query, SCHEMA } from "@/lib/db";

let ensureMailAiPromise: Promise<void> | null = null;

/** Creates mail AI cache + audit tables if missing (idempotent). */
export async function ensureMailAiTables(): Promise<void> {
  if (!ensureMailAiPromise) {
    ensureMailAiPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS ${SCHEMA}.mail_ai_cache (
          id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          message_id         UUID NOT NULL,
          kind               TEXT NOT NULL,
          cache_key          TEXT NOT NULL,
          payload_json       JSONB NOT NULL,
          source_truncated   BOOLEAN NOT NULL DEFAULT false,
          created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at         TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
          UNIQUE (user_id, message_id, kind, cache_key)
        )
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_mail_ai_cache_message ON ${SCHEMA}.mail_ai_cache (message_id)
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_mail_ai_cache_user_msg_kind ON ${SCHEMA}.mail_ai_cache (user_id, message_id, kind)
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS ${SCHEMA}.mail_ai_audit (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          message_id   UUID NOT NULL,
          action       TEXT NOT NULL,
          meta_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_mail_ai_audit_user_created ON ${SCHEMA}.mail_ai_audit (user_id, created_at DESC)
      `);
    })().catch((err) => {
      ensureMailAiPromise = null;
      throw err;
    });
  }
  return ensureMailAiPromise;
}
