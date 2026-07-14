-- Workspace-level role permission overrides (JSONB)
ALTER TABLE app_onework.workspaces
  ADD COLUMN IF NOT EXISTS rbac_config JSONB NOT NULL DEFAULT '{}'::jsonb;
