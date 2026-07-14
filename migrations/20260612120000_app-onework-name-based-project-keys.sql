-- Name-based project keys (replaces PR## fallback keys from initial backfill).
-- Prerequisites: 20260611120000_app-onework-task-keys.sql
--
-- Full re-derive from project names (multi-word initials, single-word prefix)
-- is applied by: npx tsx scripts/rekey-project-keys.ts
-- Run that script immediately after this file in deploy/apply flows.

-- Repair task_key drift: sync from projects.key + task_number
UPDATE app_onework.tasks t
SET task_key = p.key || '-' || t.task_number::text
FROM app_onework.projects p
WHERE t.project_id = p.id
  AND t.task_number IS NOT NULL
  AND p.key IS NOT NULL
  AND t.task_key IS DISTINCT FROM (p.key || '-' || t.task_number::text);

-- Workspace-scoped tasks (no project): ensure keys use workspace prefix + number
UPDATE app_onework.tasks t
SET task_key = upper(substring(regexp_replace(coalesce(w.slug, 'ws'), '[^A-Za-z0-9]', '', 'g'), 1, 10))
                 || '-' || t.task_number::text
FROM app_onework.workspaces w
WHERE t.workspace_id = w.id
  AND t.project_id IS NULL
  AND t.task_number IS NOT NULL
  AND length(regexp_replace(coalesce(w.slug, 'ws'), '[^A-Za-z0-9]', '', 'g')) >= 2
  AND t.task_key IS DISTINCT FROM (
    upper(substring(regexp_replace(coalesce(w.slug, 'ws'), '[^A-Za-z0-9]', '', 'g'), 1, 10))
    || '-' || t.task_number::text
  );
