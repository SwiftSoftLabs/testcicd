-- Billing downgrade reconciliation: grace-then-lock quota enforcement.
-- Additive only. Run manually in the InsForge dashboard.
--
-- Model: when a workspace downgrades/cancels below current usage, we stamp a
-- 14-day grace window (quota_grace_until). After it elapses, excess resources
-- are frozen read-only (quota_locked = true), oldest-stays. Re-upgrade clears
-- both. See docs / context/current-feature.md.

ALTER TABLE app_onework.workspace_subscriptions
    ADD COLUMN IF NOT EXISTS quota_grace_until TIMESTAMPTZ;

ALTER TABLE app_onework.projects
    ADD COLUMN IF NOT EXISTS quota_locked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE app_onework.conversations
    ADD COLUMN IF NOT EXISTS quota_locked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE app_onework.mail_accounts
    ADD COLUMN IF NOT EXISTS quota_locked BOOLEAN NOT NULL DEFAULT false;

-- Partial indexes keep the unlock sweep cheap (only locked rows are scanned).
CREATE INDEX IF NOT EXISTS projects_quota_locked_idx
    ON app_onework.projects (workspace_id) WHERE quota_locked;

CREATE INDEX IF NOT EXISTS conversations_quota_locked_idx
    ON app_onework.conversations (workspace_id) WHERE quota_locked;

CREATE INDEX IF NOT EXISTS mail_accounts_quota_locked_idx
    ON app_onework.mail_accounts (user_id) WHERE quota_locked;
