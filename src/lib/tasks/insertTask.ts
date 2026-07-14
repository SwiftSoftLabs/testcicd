import { buildInsert, query, SCHEMA } from '@/lib/db';
import { allocateTaskKey } from '@/lib/tasks/allocateTaskKey';

export async function insertTask(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const workspaceId = payload.workspace_id as string | undefined;
  if (!workspaceId) {
    throw new Error('workspace_id is required to create a task');
  }

  const projectId = (payload.project_id as string | null | undefined) ?? null;
  const { task_number, task_key } = await allocateTaskKey({ workspaceId, projectId });

  const { sql, params } = buildInsert(`${SCHEMA}.tasks`, {
    ...payload,
    task_number,
    task_key,
  });
  const result = await query(sql, params);
  const row = result.rows[0];
  if (!row) throw new Error('Failed to insert task');
  return row as Record<string, unknown>;
}
