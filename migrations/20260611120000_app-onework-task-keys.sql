-- Jira-style task keys: project.key + per-project task_number + task_key

ALTER TABLE app_onework.projects
  ADD COLUMN IF NOT EXISTS key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_workspace_key
  ON app_onework.projects (workspace_id, upper(key))
  WHERE key IS NOT NULL;

ALTER TABLE app_onework.tasks ALTER COLUMN task_number DROP DEFAULT;

ALTER TABLE app_onework.tasks
  ADD COLUMN IF NOT EXISTS task_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_workspace_task_key
  ON app_onework.tasks (workspace_id, task_key)
  WHERE task_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_onework.task_key_aliases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES app_onework.tasks(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  task_key     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_key_aliases_workspace_key
  ON app_onework.task_key_aliases (workspace_id, upper(task_key));

CREATE TABLE IF NOT EXISTS app_onework.project_task_counters (
  project_id   UUID PRIMARY KEY REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  next_number  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS app_onework.workspace_task_counters (
  workspace_id UUID PRIMARY KEY REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  next_number  INTEGER NOT NULL DEFAULT 1
);

-- Backfill project keys from name
DO $$
DECLARE
  proj RECORD;
  base_key TEXT;
  candidate TEXT;
  suffix INT;
  initials TEXT;
BEGIN
  FOR proj IN
    SELECT p.id, p.workspace_id, p.name
    FROM app_onework.projects p
    WHERE p.key IS NULL
    ORDER BY p.id
  LOOP
    SELECT count(*)::int INTO suffix
    FROM unnest(regexp_split_to_array(trim(proj.name), '\s+')) AS w
    WHERE w <> '';

    IF suffix >= 2 THEN
      SELECT upper(regexp_replace(coalesce(string_agg(left(w, 1), ''), ''), '[^A-Z0-9]', '', 'g'))
      INTO base_key
      FROM unnest(regexp_split_to_array(trim(proj.name), '\s+')) AS w
      WHERE w <> '';
      base_key := substring(base_key, 1, 10);
    ELSE
      base_key := upper(left(regexp_replace(trim(proj.name), '[^A-Za-z0-9]', '', 'g'), 4));
    END IF;

    IF length(base_key) < 2 THEN base_key := 'GEN'; END IF;

    candidate := base_key;
    suffix := 2;
    WHILE EXISTS (
      SELECT 1 FROM app_onework.projects p2
      WHERE p2.workspace_id = proj.workspace_id AND upper(p2.key) = candidate AND p2.id <> proj.id
    ) LOOP
      candidate := substring(base_key, 1, greatest(2, 10 - length(suffix::text))) || suffix::text;
      suffix := suffix + 1;
    END LOOP;

    UPDATE app_onework.projects SET key = candidate WHERE id = proj.id;
  END LOOP;
END $$;

-- Backfill task keys per project
DO $$
DECLARE
  scope RECORD;
  task_row RECORD;
  proj_key TEXT;
  ws_slug TEXT;
  ws_key TEXT;
  n INT;
BEGIN
  FOR scope IN SELECT DISTINCT project_id, workspace_id FROM app_onework.tasks WHERE project_id IS NOT NULL
  LOOP
    SELECT key INTO proj_key FROM app_onework.projects WHERE id = scope.project_id;
    IF proj_key IS NULL THEN CONTINUE; END IF;
    n := 0;
    FOR task_row IN
      SELECT id FROM app_onework.tasks
      WHERE project_id = scope.project_id
      ORDER BY created_at ASC NULLS LAST, id
    LOOP
      n := n + 1;
      UPDATE app_onework.tasks
      SET task_number = n, task_key = proj_key || '-' || n::text
      WHERE id = task_row.id;
    END LOOP;
    INSERT INTO app_onework.project_task_counters (project_id, next_number)
    VALUES (scope.project_id, n + 1)
    ON CONFLICT (project_id) DO UPDATE SET next_number = GREATEST(app_onework.project_task_counters.next_number, EXCLUDED.next_number);
  END LOOP;

  FOR scope IN SELECT DISTINCT workspace_id FROM app_onework.tasks WHERE project_id IS NULL
  LOOP
    SELECT slug INTO ws_slug FROM app_onework.workspaces WHERE id = scope.workspace_id;
    ws_key := upper(substring(regexp_replace(coalesce(ws_slug, 'ws'), '[^A-Za-z0-9]', '', 'g'), 1, 10));
    IF length(ws_key) < 2 THEN ws_key := 'WS'; END IF;
    n := 0;
    FOR task_row IN
      SELECT id FROM app_onework.tasks
      WHERE workspace_id = scope.workspace_id AND project_id IS NULL
      ORDER BY created_at ASC NULLS LAST, id
    LOOP
      n := n + 1;
      UPDATE app_onework.tasks
      SET task_number = n, task_key = ws_key || '-' || n::text
      WHERE id = task_row.id;
    END LOOP;
    INSERT INTO app_onework.workspace_task_counters (workspace_id, next_number)
    VALUES (scope.workspace_id, n + 1)
    ON CONFLICT (workspace_id) DO UPDATE SET next_number = GREATEST(app_onework.workspace_task_counters.next_number, EXCLUDED.next_number);
  END LOOP;
END $$;

INSERT INTO app_onework.project_task_counters (project_id, next_number)
SELECT p.id, 1 FROM app_onework.projects p
WHERE NOT EXISTS (SELECT 1 FROM app_onework.project_task_counters c WHERE c.project_id = p.id)
ON CONFLICT DO NOTHING;

INSERT INTO app_onework.workspace_task_counters (workspace_id, next_number)
SELECT w.id, 1 FROM app_onework.workspaces w
WHERE NOT EXISTS (SELECT 1 FROM app_onework.workspace_task_counters c WHERE c.workspace_id = w.id)
ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.task_key_aliases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.project_task_counters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.workspace_task_counters TO authenticated;
