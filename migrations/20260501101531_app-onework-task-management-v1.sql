ALTER TABLE app_onework.tasks
  ADD COLUMN IF NOT EXISTS task_number        SERIAL,
  ADD COLUMN IF NOT EXISTS comments_count     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachments_count  INTEGER NOT NULL DEFAULT 0;

ALTER TABLE app_onework.task_activities
  ADD COLUMN IF NOT EXISTS author_name   TEXT,
  ADD COLUMN IF NOT EXISTS author_avatar TEXT;

ALTER TABLE app_onework.projects
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT timezone('utc', now()),
  ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS app_onework.teams (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  description    TEXT,
  members_count  INTEGER     NOT NULL DEFAULT 0,
  lead_id        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE app_onework.teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teams are viewable by workspace members"
  ON app_onework.teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = teams.workspace_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member()
  );

CREATE POLICY "Teams can be created by workspace members"
  ON app_onework.teams FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = teams.workspace_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member()
  );

CREATE POLICY "Teams can be updated by workspace members"
  ON app_onework.teams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = teams.workspace_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member()
  );

CREATE POLICY "Teams can be deleted by max tier"
  ON app_onework.teams FOR DELETE
  USING (public.is_max_member());

CREATE OR REPLACE FUNCTION app_onework.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON app_onework.tasks;

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON app_onework.tasks
  FOR EACH ROW EXECUTE FUNCTION app_onework.set_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated_at ON app_onework.projects;

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON app_onework.projects
  FOR EACH ROW EXECUTE FUNCTION app_onework.set_updated_at();

DROP TRIGGER IF EXISTS trg_teams_updated_at ON app_onework.teams;

CREATE TRIGGER trg_teams_updated_at
  BEFORE UPDATE ON app_onework.teams
  FOR EACH ROW EXECUTE FUNCTION app_onework.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_tasks_status            ON app_onework.tasks(status);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id        ON app_onework.tasks(project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id       ON app_onework.tasks(assignee_id);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id      ON app_onework.tasks(workspace_id);

CREATE INDEX IF NOT EXISTS idx_task_activities_task_id ON app_onework.task_activities(task_id);

CREATE INDEX IF NOT EXISTS idx_teams_workspace_id      ON app_onework.teams(workspace_id);
