-- ============================================================
-- Git repo ↔ Vercel CI/CD links (OneWork VC v1)
-- Idempotent: safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_onework.git_repo_vercel_deployments (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id          UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  git_provider          TEXT        NOT NULL CHECK (git_provider IN ('onework')),
  repo_owner            TEXT        NOT NULL,
  repo_name             TEXT        NOT NULL,
  repo_full_name        TEXT        NOT NULL,
  vercel_project_id     TEXT        NOT NULL,
  vercel_project_name   TEXT        NOT NULL,
  production_branch     TEXT        NOT NULL DEFAULT 'main',
  gitea_deploy_token_enc TEXT,
  vercel_webhook_id     TEXT,
  enabled               BOOLEAN     NOT NULL DEFAULT true,
  created_by            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (project_id, git_provider, repo_full_name)
);

CREATE INDEX IF NOT EXISTS idx_git_repo_vercel_deployments_project
  ON app_onework.git_repo_vercel_deployments(project_id);

CREATE INDEX IF NOT EXISTS idx_git_repo_vercel_deployments_workspace
  ON app_onework.git_repo_vercel_deployments(workspace_id);

CREATE INDEX IF NOT EXISTS idx_git_repo_vercel_deployments_repo
  ON app_onework.git_repo_vercel_deployments(repo_full_name);

ALTER TABLE app_onework.git_repo_vercel_deployments ENABLE ROW LEVEL SECURITY;

-- Mirror git_project_platform_repos: workspace members can access via app API.
-- Live DB's public.is_max_member() takes no args — do not pass workspace_id.
DROP POLICY IF EXISTS "git_repo_vercel_deployments_admin" ON app_onework.git_repo_vercel_deployments;
DROP POLICY IF EXISTS "git_repo_vercel_deployments_member" ON app_onework.git_repo_vercel_deployments;
CREATE POLICY "git_repo_vercel_deployments_member" ON app_onework.git_repo_vercel_deployments
  USING (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = git_repo_vercel_deployments.workspace_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member()
  );
