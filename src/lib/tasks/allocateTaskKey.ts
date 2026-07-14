import { query, SCHEMA } from '@/lib/db';
import { deriveWorkspaceKey, formatTaskKey } from '@/lib/tasks/taskKey';

interface AllocateTaskKeyInput {
  workspaceId: string;
  projectId?: string | null;
}

interface AllocatedTaskKey {
  task_number: number;
  task_key: string;
}

export async function allocateTaskKey(
  input: AllocateTaskKeyInput,
): Promise<AllocatedTaskKey> {
  const { workspaceId, projectId } = input;

  if (projectId) {
    const [counterRes, projectRes] = await Promise.all([
      query<{ assigned_number: number }>(
        `INSERT INTO ${SCHEMA}.project_task_counters (project_id, next_number)
         VALUES ($1::uuid, 2)
         ON CONFLICT (project_id) DO UPDATE
           SET next_number = ${SCHEMA}.project_task_counters.next_number + 1
         RETURNING (${SCHEMA}.project_task_counters.next_number - 1) AS assigned_number`,
        [projectId],
      ),
      query<{ key: string }>(
        `SELECT key FROM ${SCHEMA}.projects WHERE id = $1::uuid LIMIT 1`,
        [projectId],
      ),
    ]);

    const projectKey = projectRes.rows[0]?.key;
    if (!projectKey) {
      throw new Error('Project key is not configured');
    }

    const taskNumber = counterRes.rows[0]?.assigned_number ?? 1;
    return {
      task_number: taskNumber,
      task_key: formatTaskKey(projectKey, taskNumber),
    };
  }

  const [counterRes, workspaceRes] = await Promise.all([
    query<{ assigned_number: number }>(
      `INSERT INTO ${SCHEMA}.workspace_task_counters (workspace_id, next_number)
       VALUES ($1::uuid, 2)
       ON CONFLICT (workspace_id) DO UPDATE
         SET next_number = ${SCHEMA}.workspace_task_counters.next_number + 1
       RETURNING (${SCHEMA}.workspace_task_counters.next_number - 1) AS assigned_number`,
      [workspaceId],
    ),
    query<{ slug: string }>(
      `SELECT slug FROM ${SCHEMA}.workspaces WHERE id = $1::uuid LIMIT 1`,
      [workspaceId],
    ),
  ]);

  const slug = workspaceRes.rows[0]?.slug ?? 'ws';
  const prefix = deriveWorkspaceKey(slug);
  const taskNumber = counterRes.rows[0]?.assigned_number ?? 1;

  return {
    task_number: taskNumber,
    task_key: formatTaskKey(prefix, taskNumber),
  };
}
