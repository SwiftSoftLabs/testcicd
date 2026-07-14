-- Optional: run in console if you prefer explicit migrations over runtime ensureMailAiTables().
-- Caches on-demand email AI outputs (digest etc.) and records audit events.

CREATE TABLE IF NOT EXISTS app_onework.mail_ai_cache (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id         UUID NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('digest', 'reply_hint', 'reply_drafts', 'thread_digest', 'compare')),
  cache_key          TEXT NOT NULL,
  payload_json       JSONB NOT NULL,
  source_truncated   BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  UNIQUE (user_id, message_id, kind, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_mail_ai_cache_message ON app_onework.mail_ai_cache (message_id);
CREATE INDEX IF NOT EXISTS idx_mail_ai_cache_user_msg_kind ON app_onework.mail_ai_cache (user_id, message_id, kind);

CREATE TABLE IF NOT EXISTS app_onework.mail_ai_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id   UUID NOT NULL,
  action       TEXT NOT NULL,
  meta_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_ai_audit_user_created ON app_onework.mail_ai_audit (user_id, created_at DESC);
