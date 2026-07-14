-- Task platform plugins (Trello, Jira, ClickUp) — workspace-scoped sync into tasks.

CREATE TABLE IF NOT EXISTS app_onework.task_plugin_installations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  installed_by        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('trello', 'jira', 'clickup', 'asana')),
  account_id          TEXT NOT NULL,
  account_name        TEXT,
  account_email       TEXT,
  encrypted_token     TEXT NOT NULL,
  encrypted_refresh   TEXT,
  status              TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'revoked')),
  settings            JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_cursor         JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at      TIMESTAMPTZ,
  last_sync_error     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS app_onework.plugin_project_links (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id         UUID NOT NULL REFERENCES app_onework.task_plugin_installations(id) ON DELETE CASCADE,
  project_id              UUID REFERENCES app_onework.projects(id) ON DELETE SET NULL,
  external_container_id   TEXT NOT NULL,
  external_container_name TEXT,
  status_map              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (installation_id, external_container_id)
);

CREATE TABLE IF NOT EXISTS app_onework.plugin_task_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id     UUID NOT NULL REFERENCES app_onework.task_plugin_installations(id) ON DELETE CASCADE,
  task_id             UUID NOT NULL REFERENCES app_onework.tasks(id) ON DELETE CASCADE,
  external_task_id    TEXT NOT NULL,
  sync_origin         TEXT NOT NULL DEFAULT 'import' CHECK (sync_origin IN ('import', 'export')),
  external_updated_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (installation_id, external_task_id),
  UNIQUE (task_id)
);

CREATE INDEX IF NOT EXISTS task_plugin_installations_workspace_idx
  ON app_onework.task_plugin_installations(workspace_id, provider);

CREATE INDEX IF NOT EXISTS plugin_project_links_installation_idx
  ON app_onework.plugin_project_links(installation_id);

CREATE INDEX IF NOT EXISTS plugin_task_links_installation_idx
  ON app_onework.plugin_task_links(installation_id);

CREATE INDEX IF NOT EXISTS plugin_task_links_task_idx
  ON app_onework.plugin_task_links(task_id);

-- Extend tasks for plugin-sourced rows
ALTER TABLE app_onework.tasks
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'local';

ALTER TABLE app_onework.tasks
  ADD COLUMN IF NOT EXISTS source_plugin_provider TEXT;

ALTER TABLE app_onework.tasks
  ADD COLUMN IF NOT EXISTS source_plugin_installation_id UUID
  REFERENCES app_onework.task_plugin_installations(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_source_check'
  ) THEN
    ALTER TABLE app_onework.tasks
      ADD CONSTRAINT tasks_source_check CHECK (source IN ('local', 'plugin'));
  END IF;
END $$;

GRANT ALL PRIVILEGES ON app_onework.task_plugin_installations TO app_onework_user;
GRANT ALL PRIVILEGES ON app_onework.plugin_project_links TO app_onework_user;
GRANT ALL PRIVILEGES ON app_onework.plugin_task_links TO app_onework_user;

ALTER TABLE app_onework.task_plugin_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.plugin_project_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.plugin_task_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_plugin_installations_member_access" ON app_onework.task_plugin_installations;
CREATE POLICY "task_plugin_installations_member_access" ON app_onework.task_plugin_installations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = task_plugin_installations.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = task_plugin_installations.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "plugin_project_links_member_access" ON app_onework.plugin_project_links;
CREATE POLICY "plugin_project_links_member_access" ON app_onework.plugin_project_links
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.task_plugin_installations i
      JOIN app_onework.workspace_members wm ON wm.workspace_id = i.workspace_id
      WHERE i.id = plugin_project_links.installation_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM app_onework.task_plugin_installations i
      JOIN app_onework.workspace_members wm ON wm.workspace_id = i.workspace_id
      WHERE i.id = plugin_project_links.installation_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "plugin_task_links_member_access" ON app_onework.plugin_task_links;
CREATE POLICY "plugin_task_links_member_access" ON app_onework.plugin_task_links
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.task_plugin_installations i
      JOIN app_onework.workspace_members wm ON wm.workspace_id = i.workspace_id
      WHERE i.id = plugin_task_links.installation_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM app_onework.task_plugin_installations i
      JOIN app_onework.workspace_members wm ON wm.workspace_id = i.workspace_id
      WHERE i.id = plugin_task_links.installation_id
        AND wm.user_id = auth.uid()
    )
  );
