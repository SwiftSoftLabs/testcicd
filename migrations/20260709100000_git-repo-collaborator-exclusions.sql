-- Track repo collaborators explicitly removed so workspace sync does not re-add them.
CREATE TABLE IF NOT EXISTS app_onework.git_repo_collaborator_exclusions (
  workspace_id uuid NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  repo_owner text NOT NULL,
  repo_name text NOT NULL,
  gitea_username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, repo_owner, repo_name, gitea_username)
);

CREATE INDEX IF NOT EXISTS idx_git_repo_collab_excl_repo
  ON app_onework.git_repo_collaborator_exclusions (workspace_id, repo_owner, repo_name);
