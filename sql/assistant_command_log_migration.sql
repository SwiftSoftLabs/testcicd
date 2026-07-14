-- Dock voice assistant audit log (app_onework schema)
CREATE TABLE IF NOT EXISTS app_onework.assistant_command_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id    UUID,
  transcript      TEXT NOT NULL,
  tool_name       TEXT,
  tool_args_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome         TEXT NOT NULL DEFAULT 'ok',
  spoken_reply    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_command_log_user_created
  ON app_onework.assistant_command_log (user_id, created_at DESC);
