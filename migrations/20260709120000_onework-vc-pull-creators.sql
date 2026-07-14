-- Track OneWork user who opened a PR (authoritative when Gitea author is wrong).
CREATE TABLE IF NOT EXISTS app_onework.onework_vc_pull_creators (
  workspace_id UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  pr_number INTEGER NOT NULL CHECK (pr_number > 0),
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, repo_owner, repo_name, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_onework_vc_pull_creators_user
  ON app_onework.onework_vc_pull_creators (created_by_user_id);

ALTER TABLE app_onework.onework_vc_pull_creators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "onework_vc_pull_creators_member_read"
  ON app_onework.onework_vc_pull_creators;

CREATE POLICY "onework_vc_pull_creators_member_read"
  ON app_onework.onework_vc_pull_creators
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = onework_vc_pull_creators.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
