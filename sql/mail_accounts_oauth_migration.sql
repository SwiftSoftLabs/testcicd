-- OneWork: add OAuth support to external mail accounts (run against app schema)
-- Replace app_onework with your schema if different.

ALTER TABLE app_onework.mail_accounts
  ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'password'
    CHECK (auth_method IN ('password', 'oauth'));

ALTER TABLE app_onework.mail_accounts
  ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT;

ALTER TABLE app_onework.mail_accounts
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
