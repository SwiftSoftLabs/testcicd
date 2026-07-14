-- ============================================================
-- Migration 005: Environment Vault Tables (PROJECT-SCOPED, PRD v2.3)
-- For existing clusters that already ran SETUP_DATABASE.sql.
-- Run AFTER migrations 001–004.
--
-- DESTRUCTIVE: drops any pre-existing v2.2 (workspace-scoped) vault
-- tables before recreating them under the v2.3 (project-scoped) shape.
-- No production vault data existed at the time of this migration.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app_onework' AND table_name = 'vault_workspace_keys'
  ) THEN
    RAISE NOTICE 'Found v2.2 workspace-scoped vault tables — dropping for v2.3 project-scoped rebuild.';
  END IF;
END $$;

DROP TABLE IF EXISTS app_onework.vault_cli_tokens     CASCADE;
DROP TABLE IF EXISTS app_onework.vault_sync_events    CASCADE;
DROP TABLE IF EXISTS app_onework.vault_sync_targets   CASCADE;
DROP TABLE IF EXISTS app_onework.vault_audit_log      CASCADE;
DROP TABLE IF EXISTS app_onework.vault_variables      CASCADE;
DROP TABLE IF EXISTS app_onework.vault_environments   CASCADE;
DROP TABLE IF EXISTS app_onework.vault_workspace_keys CASCADE;
DROP TABLE IF EXISTS app_onework.vault_project_keys   CASCADE;

CREATE TABLE IF NOT EXISTS app_onework.vault_project_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL UNIQUE REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  wrapped_dek  TEXT        NOT NULL,
  dek_iv       TEXT        NOT NULL,
  dek_auth_tag TEXT        NOT NULL,
  algorithm    TEXT        NOT NULL DEFAULT 'aes-256-gcm',
  key_version  INTEGER     NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_project_keys_workspace ON app_onework.vault_project_keys(workspace_id);

CREATE TABLE IF NOT EXISTS app_onework.vault_environments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  description  TEXT,
  is_system    BOOLEAN     NOT NULL DEFAULT false,
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_vault_environments_project   ON app_onework.vault_environments(project_id);
CREATE INDEX IF NOT EXISTS idx_vault_environments_workspace ON app_onework.vault_environments(workspace_id);

CREATE TABLE IF NOT EXISTS app_onework.vault_variables (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id   UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  environment_id UUID        NOT NULL REFERENCES app_onework.vault_environments(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL CHECK (name ~ '^[A-Z_][A-Z0-9_]*$'),
  ciphertext     TEXT        NOT NULL,
  iv             TEXT        NOT NULL,
  auth_tag       TEXT        NOT NULL,
  algorithm      TEXT        NOT NULL DEFAULT 'aes-256-gcm',
  key_version    INTEGER     NOT NULL DEFAULT 1,
  created_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, environment_id, name)
);
CREATE INDEX IF NOT EXISTS idx_vault_variables_env       ON app_onework.vault_variables(environment_id);
CREATE INDEX IF NOT EXISTS idx_vault_variables_project   ON app_onework.vault_variables(project_id);
CREATE INDEX IF NOT EXISTS idx_vault_variables_workspace ON app_onework.vault_variables(workspace_id);

CREATE TABLE IF NOT EXISTS app_onework.vault_audit_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id   UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  actor_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL,
  resource_type  TEXT        NOT NULL DEFAULT 'variable',
  resource_id    UUID,
  environment_id UUID,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_audit_project   ON app_onework.vault_audit_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_audit_workspace ON app_onework.vault_audit_log(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_onework.vault_sync_targets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  provider     TEXT        NOT NULL DEFAULT 'github',
  config       JSONB       NOT NULL DEFAULT '{}',
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_sync_targets_project   ON app_onework.vault_sync_targets(project_id);
CREATE INDEX IF NOT EXISTS idx_vault_sync_targets_workspace ON app_onework.vault_sync_targets(workspace_id);

CREATE TABLE IF NOT EXISTS app_onework.vault_sync_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_target_id UUID        NOT NULL REFERENCES app_onework.vault_sync_targets(id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'pending',
  metadata       JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_onework.vault_cli_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL,
  scopes       TEXT[]      NOT NULL DEFAULT '{}',
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_cli_tokens_project   ON app_onework.vault_cli_tokens(project_id);
CREATE INDEX IF NOT EXISTS idx_vault_cli_tokens_workspace ON app_onework.vault_cli_tokens(workspace_id);

-- RLS
ALTER TABLE app_onework.vault_project_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_variables    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_sync_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_sync_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_cli_tokens   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vault_project_keys_admin_select" ON app_onework.vault_project_keys;
CREATE POLICY "vault_project_keys_admin_select" ON app_onework.vault_project_keys
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspaces w ON w.id = p.workspace_id
            LEFT JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_project_keys.project_id
              AND (w.owner_id = auth.uid() OR wm.role = 'admin')
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_environments_member_select" ON app_onework.vault_environments;
CREATE POLICY "vault_environments_member_select" ON app_onework.vault_environments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_environments.project_id
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_environments_admin_write" ON app_onework.vault_environments;
CREATE POLICY "vault_environments_admin_write" ON app_onework.vault_environments
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspaces w ON w.id = p.workspace_id
            LEFT JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_environments.project_id
              AND (w.owner_id = auth.uid() OR wm.role = 'admin')
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_variables_member_select" ON app_onework.vault_variables;
CREATE POLICY "vault_variables_member_select" ON app_onework.vault_variables
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_variables.project_id
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_variables_admin_write" ON app_onework.vault_variables;
CREATE POLICY "vault_variables_admin_write" ON app_onework.vault_variables
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspaces w ON w.id = p.workspace_id
            LEFT JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_variables.project_id
              AND (w.owner_id = auth.uid() OR wm.role = 'admin')
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_audit_log_admin_select" ON app_onework.vault_audit_log;
CREATE POLICY "vault_audit_log_admin_select" ON app_onework.vault_audit_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspaces w ON w.id = p.workspace_id
            LEFT JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_audit_log.project_id
              AND (w.owner_id = auth.uid() OR wm.role = 'admin')
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_sync_targets_admin" ON app_onework.vault_sync_targets;
CREATE POLICY "vault_sync_targets_admin" ON app_onework.vault_sync_targets
    FOR ALL USING (public.is_max_member(auth.uid()));

DROP POLICY IF EXISTS "vault_sync_events_admin" ON app_onework.vault_sync_events;
CREATE POLICY "vault_sync_events_admin" ON app_onework.vault_sync_events
    FOR ALL USING (public.is_max_member(auth.uid()));

DROP POLICY IF EXISTS "vault_cli_tokens_owner" ON app_onework.vault_cli_tokens;
CREATE POLICY "vault_cli_tokens_owner" ON app_onework.vault_cli_tokens
    FOR ALL USING (user_id = auth.uid() OR public.is_max_member(auth.uid()));
