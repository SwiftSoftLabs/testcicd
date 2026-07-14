import { loadEnvConfig } from '@next/env';

interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  key: string | null;
}

interface ProjectMapping {
  project: ProjectRow;
  newKey: string;
}

/**
 * Re-derive all project keys from full sanitized project names
 * and sync task_key prefixes for affected tasks.
 */
async function main() {
  loadEnvConfig(process.cwd());
  const { pickUniqueProjectKey } = await import('@/lib/tasks/taskKey');
  const { query, SCHEMA } = await import('@/lib/db');

  const projectsRes = await query<ProjectRow>(
    `SELECT id, workspace_id, name, key
     FROM ${SCHEMA}.projects
     ORDER BY workspace_id, created_at ASC NULLS LAST, id`,
  );

  const byWorkspace = new Map<string, ProjectRow[]>();
  for (const row of projectsRes.rows) {
    const list = byWorkspace.get(row.workspace_id) ?? [];
    list.push(row);
    byWorkspace.set(row.workspace_id, list);
  }

  const mappingsByWorkspace = new Map<string, ProjectMapping[]>();

  for (const [workspaceId, projects] of byWorkspace) {
    const sorted = [...projects].sort(
      (a, b) => a.name.length - b.name.length || a.id.localeCompare(b.id),
    );
    const taken = new Set<string>();
    const mappings: ProjectMapping[] = [];
    for (const project of sorted) {
      const newKey = pickUniqueProjectKey(project.name, taken);
      taken.add(newKey.toUpperCase());
      mappings.push({ project, newKey });
    }
    mappingsByWorkspace.set(workspaceId, mappings);
  }

  let projectsUpdated = 0;
  let tasksUpdated = 0;

  for (const [workspaceId, mappings] of mappingsByWorkspace) {
    const changing = mappings.filter(
      (m) => m.project.key?.toUpperCase() !== m.newKey.toUpperCase(),
    );
    if (changing.length === 0) continue;

    for (const { project, newKey } of changing) {
      process.stdout.write(
        `  ${project.name}: ${project.key ?? '(none)'} → ${newKey}\n`,
      );
    }

    await query(
      `INSERT INTO ${SCHEMA}.task_key_aliases (task_id, workspace_id, task_key)
       SELECT t.id, t.workspace_id, t.task_key
       FROM ${SCHEMA}.tasks t
       JOIN ${SCHEMA}.projects p ON p.id = t.project_id
       WHERE p.workspace_id = $1
         AND t.task_key IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM ${SCHEMA}.task_key_aliases a
           WHERE a.workspace_id = t.workspace_id
             AND upper(a.task_key) = upper(t.task_key)
         )`,
      [workspaceId],
    );

    await query(
      `UPDATE ${SCHEMA}.projects
       SET key = 'TMP' || replace(id::text, '-', '')
       WHERE workspace_id = $1`,
      [workspaceId],
    );

    await query(
      `UPDATE ${SCHEMA}.tasks t
       SET task_key = 'TMP' || replace(t.id::text, '-', '')
       FROM ${SCHEMA}.projects p
       WHERE t.project_id = p.id
         AND p.workspace_id = $1
         AND t.task_key IS NOT NULL`,
      [workspaceId],
    );

    for (const { project, newKey } of mappings) {
      await query(
        `UPDATE ${SCHEMA}.projects SET key = $1 WHERE id = $2`,
        [newKey, project.id],
      );
      if (project.key?.toUpperCase() !== newKey.toUpperCase()) {
        projectsUpdated += 1;
      }
    }

    const taskRes = await query<{ count: string }>(
      `UPDATE ${SCHEMA}.tasks t
       SET task_key = p.key || '-' || t.task_number::text
       FROM ${SCHEMA}.projects p
       WHERE t.project_id = p.id
         AND p.workspace_id = $1
         AND t.task_number IS NOT NULL
       RETURNING t.id`,
      [workspaceId],
    );
    tasksUpdated += taskRes.rows.length;
  }

  process.stdout.write(
    `Re-key complete: ${projectsUpdated} project(s), ${tasksUpdated} task(s) updated.\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Re-key failed: ${message}\n`);
  process.exit(1);
});
