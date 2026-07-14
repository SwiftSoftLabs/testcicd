-- OneWork Version Control (platform-managed Git, Gitea-backed)
-- Run against InsForge PostgreSQL (schema: app_onework)

-- Extend git_integrations provider + auth_method
ALTER TABLE app_onework.git_integrations
  DROP CONSTRAINT IF EXISTS git_integrations_provider_check;

ALTER TABLE app_onework.git_integrations
  ADD CONSTRAINT git_integrations_provider_check
  CHECK (provider IN ('github', 'gitlab', 'onework'));

ALTER TABLE app_onework.git_integrations
  DROP CONSTRAINT IF EXISTS git_integrations_auth_method_check;

ALTER TABLE app_onework.git_integrations
  ADD CONSTRAINT git_integrations_auth_method_check
  CHECK (auth_method IN ('oauth', 'pat', 'platform'));

-- Gitea user mapping (global per OneWork user)
CREATE TABLE IF NOT EXISTS app_onework.onework_vc_accounts (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gitea_user_id   INTEGER NOT NULL,
  gitea_username  TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspace → Gitea org mapping
CREATE TABLE IF NOT EXISTS app_onework.onework_vc_workspaces (
  workspace_id    UUID PRIMARY KEY REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  gitea_org_name  TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Shared platform repo per project (all workspace members)
CREATE TABLE IF NOT EXISTS app_onework.git_project_platform_repos (
  project_id        UUID PRIMARY KEY REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id      UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL DEFAULT 'onework' CHECK (provider IN ('onework')),
  repo_external_id  TEXT NOT NULL,
  repo_full_name    TEXT NOT NULL,
  repo_owner        TEXT NOT NULL,
  repo_name         TEXT NOT NULL,
  default_branch    TEXT NOT NULL DEFAULT 'main',
  is_private        BOOLEAN NOT NULL DEFAULT true,
  html_url          TEXT NOT NULL DEFAULT '',
  clone_url         TEXT NOT NULL DEFAULT '',
  ssh_url           TEXT NOT NULL DEFAULT '',
  description       TEXT,
  homepage          TEXT,
  license           TEXT,
  stargazers_count  INTEGER NOT NULL DEFAULT 0,
  updated_at_repo   TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_git_platform_repos_ws
  ON app_onework.git_project_platform_repos(workspace_id);

ALTER TABLE app_onework.onework_vc_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.onework_vc_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.git_project_platform_repos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "onework_vc_accounts_owner" ON app_onework.onework_vc_accounts
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "onework_vc_workspaces_member_read" ON app_onework.onework_vc_workspaces
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = onework_vc_workspaces.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "git_platform_repos_member_read" ON app_onework.git_project_platform_repos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = git_project_platform_repos.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
