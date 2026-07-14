-- Per-user, per-project linked Git repositories (Version Control scope)
-- Replace app_onework with your schema if different.

CREATE TABLE IF NOT EXISTS app_onework.git_project_linked_repos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id        UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('github','gitlab','onework')),
  repo_external_id    TEXT NOT NULL,
  repo_full_name      TEXT NOT NULL,
  repo_owner          TEXT NOT NULL,
  repo_name           TEXT NOT NULL,
  default_branch      TEXT NOT NULL DEFAULT 'main',
  is_private          BOOLEAN NOT NULL DEFAULT false,
  html_url            TEXT NOT NULL DEFAULT '',
  clone_url           TEXT NOT NULL DEFAULT '',
  ssh_url             TEXT NOT NULL DEFAULT '',
  description         TEXT,
  homepage            TEXT,
  license             TEXT,
  stargazers_count    INTEGER NOT NULL DEFAULT 0,
  updated_at_repo     TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, user_id, provider, repo_owner, repo_name)
);

CREATE INDEX IF NOT EXISTS idx_git_proj_linked_project_user
  ON app_onework.git_project_linked_repos(project_id, user_id, provider);

ALTER TABLE app_onework.git_project_linked_repos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "git_project_linked_repos_owner_access" ON app_onework.git_project_linked_repos
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "git_project_linked_repos_max_read" ON app_onework.git_project_linked_repos
  FOR SELECT USING (public.is_max_member(auth.uid()));
