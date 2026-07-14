-- OneWork VC branch protection rules (per project)

CREATE TABLE IF NOT EXISTS app_onework.vc_branch_protection_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  branch_pattern TEXT NOT NULL DEFAULT 'main',
  require_approval_count INT NOT NULL DEFAULT 1,
  require_status_checks BOOLEAN NOT NULL DEFAULT false,
  required_check_names TEXT[] DEFAULT '{}',
  block_force_push BOOLEAN NOT NULL DEFAULT true,
  allow_admin_bypass BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, branch_pattern)
);

CREATE INDEX IF NOT EXISTS idx_vc_branch_protection_project
  ON app_onework.vc_branch_protection_rules(project_id);

ALTER TABLE app_onework.vc_branch_protection_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vc_branch_protection_member_read" ON app_onework.vc_branch_protection_rules
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM app_onework.projects p
      JOIN app_onework.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = vc_branch_protection_rules.project_id
        AND wm.user_id = auth.uid()
    )
  );
