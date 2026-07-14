-- Team performance analytics support.
-- RUN MANUALLY in InsForge against the app_onework schema.

ALTER TABLE app_onework.tasks
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

UPDATE app_onework.tasks
SET completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE status = 'done'
  AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_completed_at
  ON app_onework.tasks(workspace_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_onework.teams (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  lead_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_teams_workspace
  ON app_onework.teams(workspace_id, name);

CREATE TABLE IF NOT EXISTS app_onework.team_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES app_onework.teams(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team
  ON app_onework.team_members(team_id);

CREATE INDEX IF NOT EXISTS idx_team_members_user
  ON app_onework.team_members(user_id);

GRANT ALL PRIVILEGES ON app_onework.teams TO app_onework_user;
GRANT ALL PRIVILEGES ON app_onework.team_members TO app_onework_user;

ALTER TABLE app_onework.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teams_member_select" ON app_onework.teams;
CREATE POLICY "teams_member_select" ON app_onework.teams
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = teams.workspace_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member(auth.uid())
  );

DROP POLICY IF EXISTS "teams_admin_write" ON app_onework.teams;
CREATE POLICY "teams_admin_write" ON app_onework.teams
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.workspaces w
      LEFT JOIN app_onework.workspace_members wm
        ON wm.workspace_id = teams.workspace_id
       AND wm.user_id = auth.uid()
      WHERE w.id = teams.workspace_id
        AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
    )
    OR public.is_max_member(auth.uid())
  );

DROP POLICY IF EXISTS "team_members_member_select" ON app_onework.team_members;
CREATE POLICY "team_members_member_select" ON app_onework.team_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM app_onework.teams t
      JOIN app_onework.workspace_members wm
        ON wm.workspace_id = t.workspace_id
      WHERE t.id = team_members.team_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member(auth.uid())
  );

DROP POLICY IF EXISTS "team_members_admin_write" ON app_onework.team_members;
CREATE POLICY "team_members_admin_write" ON app_onework.team_members
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.teams t
      JOIN app_onework.workspaces w ON w.id = t.workspace_id
      LEFT JOIN app_onework.workspace_members wm
        ON wm.workspace_id = t.workspace_id
       AND wm.user_id = auth.uid()
      WHERE t.id = team_members.team_id
        AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
    )
    OR public.is_max_member(auth.uid())
  );
