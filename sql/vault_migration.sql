-- ============================================================
-- Environment Vault Migration — Phase 1 (PROJECT-SCOPED, PRD v2.3)
-- Schema: app_onework
--
-- Vault is project-scoped: each project has its own DEK,
-- environments, variables, and audit log. workspace_id is
-- denormalized on every row for fast plan-tier and admin queries.
--
-- DESTRUCTIVE: this migration drops any pre-existing v2.2
-- (workspace-scoped) vault tables before recreating them under
-- the v2.3 (project-scoped) shape. No production vault data
-- existed at the time of this migration.
--
-- Binary fields (IV, auth tag, ciphertext, wrapped DEK) are
-- stored as base64-encoded TEXT to avoid BYTEA encoding
-- ambiguity through the InsForge HTTP bridge.
-- ============================================================

-- Drop v2.2 workspace-scoped tables (and any partial v2.3 state)
DROP TABLE IF EXISTS app_onework.vault_cli_tokens     CASCADE;
DROP TABLE IF EXISTS app_onework.vault_sync_events    CASCADE;
DROP TABLE IF EXISTS app_onework.vault_sync_targets   CASCADE;
DROP TABLE IF EXISTS app_onework.vault_audit_log      CASCADE;
DROP TABLE IF EXISTS app_onework.vault_variables      CASCADE;
DROP TABLE IF EXISTS app_onework.vault_environments   CASCADE;
DROP TABLE IF EXISTS app_onework.vault_workspace_keys CASCADE;
DROP TABLE IF EXISTS app_onework.vault_project_keys   CASCADE;

-- ============================================================
-- TABLE: vault_project_keys
-- One row per project. Stores the project DEK wrapped
-- (AES-256-GCM encrypted) under the server-only VAULT_MASTER_KEY.
-- ============================================================
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

-- ============================================================
-- TABLE: vault_environments
-- Project environments. is_system=true rows (development,
-- preview, production) are seeded on first vault open per project
-- and cannot be renamed or deleted via P1 APIs.
-- ============================================================
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

-- ============================================================
-- TABLE: vault_variables
-- Encrypted variable values, scoped per project + environment.
-- ciphertext/iv/auth_tag are each base64 TEXT. The DB CHECK
-- enforces uppercase naming as a secondary guard behind Zod.
-- ============================================================
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

-- ============================================================
-- TABLE: vault_audit_log
-- Append-only audit trail. metadata JSONB must never contain
-- plaintext values, ciphertexts, IVs, auth tags, or DEK material.
-- ============================================================
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

-- ============================================================
-- TABLE: vault_sync_targets (P2 schema stub — no P1 business logic)
-- Maps a Vault project to one external sync destination
-- (GitHub repo or Vercel project).
-- ============================================================
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

-- ============================================================
-- TABLE: vault_sync_events (P2 schema stub)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_onework.vault_sync_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_target_id UUID        NOT NULL REFERENCES app_onework.vault_sync_targets(id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'pending',
  metadata       JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: vault_cli_tokens (P3 schema stub)
-- Tokens are bound to a specific project.
-- ============================================================
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

-- ============================================================
-- RLS — defense-in-depth. All Vault routes use the service key
-- which bypasses RLS. These policies guard against accidental
-- anon/browser key exposure only.
--
-- All policies walk project_id -> projects.workspace_id ->
-- workspace_members.user_id to determine access.
-- ============================================================

ALTER TABLE app_onework.vault_project_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_variables    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_sync_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_sync_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_cli_tokens   ENABLE ROW LEVEL SECURITY;

-- vault_project_keys: owner/admin select + max override
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

-- vault_environments: workspace member select, admin write
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

-- vault_variables: workspace member select, admin write
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

-- vault_audit_log: admin select only
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

-- vault_sync_targets / vault_sync_events / vault_cli_tokens: admin/owner only
DROP POLICY IF EXISTS "vault_sync_targets_admin" ON app_onework.vault_sync_targets;
CREATE POLICY "vault_sync_targets_admin" ON app_onework.vault_sync_targets
    FOR ALL USING (public.is_max_member(auth.uid()));

DROP POLICY IF EXISTS "vault_sync_events_admin" ON app_onework.vault_sync_events;
CREATE POLICY "vault_sync_events_admin" ON app_onework.vault_sync_events
    FOR ALL USING (public.is_max_member(auth.uid()));

DROP POLICY IF EXISTS "vault_cli_tokens_owner" ON app_onework.vault_cli_tokens;
CREATE POLICY "vault_cli_tokens_owner" ON app_onework.vault_cli_tokens
    FOR ALL USING (user_id = auth.uid() OR public.is_max_member(auth.uid()));
