-- Vault CLI token security: indexed lookup, environment allowlist, legacy token revocation.
-- Existing active tokens without token_lookup are revoked; users must create new tokens.

ALTER TABLE app_onework.vault_cli_tokens
  ADD COLUMN IF NOT EXISTS name TEXT;

ALTER TABLE app_onework.vault_cli_tokens
  ADD COLUMN IF NOT EXISTS token_lookup TEXT;

ALTER TABLE app_onework.vault_cli_tokens
  ADD COLUMN IF NOT EXISTS allowed_environments TEXT[];

UPDATE app_onework.vault_cli_tokens
SET revoked_at = NOW()
WHERE token_lookup IS NULL
  AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_cli_tokens_lookup_active
  ON app_onework.vault_cli_tokens(token_lookup)
  WHERE token_lookup IS NOT NULL AND revoked_at IS NULL;
