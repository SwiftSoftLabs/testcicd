CREATE TABLE IF NOT EXISTS app_onework.project_repositories (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id       UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  git_integration_id UUID        REFERENCES app_onework.git_integrations(id) ON DELETE SET NULL,
  provider           TEXT        NOT NULL CHECK (provider IN ('github', 'gitlab')),
  owner              TEXT        NOT NULL,
  repo               TEXT        NOT NULL,
  full_name          TEXT        NOT NULL,
  default_branch     TEXT        NOT NULL DEFAULT 'main',
  description        TEXT,
  is_private         BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, provider, full_name)
);

ALTER TABLE app_onework.project_repositories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_repos_member_read" ON app_onework.project_repositories
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = project_repositories.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "project_repos_max_read" ON app_onework.project_repositories
  FOR SELECT USING (public.is_max_member(auth.uid()));

ALTER TABLE app_onework.commits
  ADD COLUMN IF NOT EXISTS repository_id     UUID REFERENCES app_onework.project_repositories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workspace_id      UUID REFERENCES app_onework.workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sha               TEXT,
  ADD COLUMN IF NOT EXISTS author_name       TEXT,
  ADD COLUMN IF NOT EXISTS author_email      TEXT,
  ADD COLUMN IF NOT EXISTS author_avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS committed_at      TIMESTAMPTZ;

ALTER TABLE app_onework.pull_requests
  ADD COLUMN IF NOT EXISTS repository_id       UUID REFERENCES app_onework.project_repositories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workspace_id        UUID REFERENCES app_onework.workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_id         TEXT,
  ADD COLUMN IF NOT EXISTS author_name         TEXT,
  ADD COLUMN IF NOT EXISTS author_avatar_url   TEXT,
  ADD COLUMN IF NOT EXISTS commits_count       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS files_changed_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_project_repos_workspace  ON app_onework.project_repositories(workspace_id);

CREATE INDEX IF NOT EXISTS idx_project_repos_project    ON app_onework.project_repositories(project_id);

CREATE INDEX IF NOT EXISTS idx_commits_workspace        ON app_onework.commits(workspace_id);

CREATE INDEX IF NOT EXISTS idx_commits_repository       ON app_onework.commits(repository_id);

CREATE INDEX IF NOT EXISTS idx_commits_message          ON app_onework.commits USING gin(to_tsvector('english', message));

CREATE INDEX IF NOT EXISTS idx_pull_requests_workspace  ON app_onework.pull_requests(workspace_id);

CREATE INDEX IF NOT EXISTS idx_pull_requests_repository ON app_onework.pull_requests(repository_id);
