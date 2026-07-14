import { query, SCHEMA } from '@/lib/db';
import { allocateTaskKey } from '@/lib/tasks/allocateTaskKey';
import { logTaskSystemActivity } from '@/lib/tasks/logTaskSystemActivity';

interface ReassignTaskKeyOnMoveInput {
  taskId: string;
  workspaceId: string;
  fromProjectId: string | null;
  toProjectId: string | null;
  actorUserId: string;
  movedWithParent?: boolean;
}

interface ReassignTaskKeyResult {
  old_key: string | null;
  new_key: string;
  task_number: number;
  task_key: string;
  from_project_name: string;
  to_project_name: string;
}

async function projectDisplayName(projectId: string | null): Promise<string> {
  if (!projectId) return 'No project';
  const res = await query<{ name: string }>(
    `SELECT name FROM ${SCHEMA}.projects WHERE id = $1 LIMIT 1`,
    [projectId],
  );
  return res.rows[0]?.name ?? 'Unknown project';
}

export async function reassignTaskKeyOnMove(
  input: ReassignTaskKeyOnMoveInput,
): Promise<ReassignTaskKeyResult> {
  const taskRes = await query<{ task_key: string | null }>(
    `SELECT task_key FROM ${SCHEMA}.tasks WHERE id = $1 LIMIT 1`,
    [input.taskId],
  );
  const oldKey = taskRes.rows[0]?.task_key ?? null;

  const { task_number, task_key } = await allocateTaskKey({
    workspaceId: input.workspaceId,
    projectId: input.toProjectId,
  });

  if (oldKey) {
    await query(
      `INSERT INTO ${SCHEMA}.task_key_aliases (task_id, workspace_id, task_key)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [input.taskId, input.workspaceId, oldKey],
    );
  }

  await query(
    `UPDATE ${SCHEMA}.tasks
     SET project_id = $1, task_number = $2, task_key = $3
     WHERE id = $4`,
    [input.toProjectId, task_number, task_key, input.taskId],
  );

  const [fromName, toName, actorRes] = await Promise.all([
    projectDisplayName(input.fromProjectId),
    projectDisplayName(input.toProjectId),
    query<{ full_name: string | null }>(
      `SELECT full_name FROM ${SCHEMA}.profiles WHERE id = $1 LIMIT 1`,
      [input.actorUserId],
    ),
  ]);

  const actor = actorRes.rows[0]?.full_name ?? 'Someone';
  const suffix = input.movedWithParent ? ' (moved with parent task).' : '.';
  const content = oldKey
    ? `${actor} moved this task from ${fromName} (${oldKey}) to ${toName} (${task_key})${suffix}`
    : `${actor} moved this task from ${fromName} to ${toName} (${task_key})${suffix}`;

  await logTaskSystemActivity({
    taskId: input.taskId,
    actorUserId: input.actorUserId,
    content,
  });

  return {
    old_key: oldKey,
    new_key: task_key,
    task_number,
    task_key,
    from_project_name: fromName,
    to_project_name: toName,
  };
}

export async function cascadeSubtasksOnProjectMove(
  parentTaskId: string,
  workspaceId: string,
  toProjectId: string | null,
  actorUserId: string,
): Promise<void> {
  const childrenRes = await query<{ id: string; project_id: string | null }>(
    `SELECT id, project_id FROM ${SCHEMA}.tasks
     WHERE parent_task_id = $1
     ORDER BY created_at ASC`,
    [parentTaskId],
  );

  for (const child of childrenRes.rows) {
    if (child.project_id === toProjectId) continue;
    await reassignTaskKeyOnMove({
      taskId: child.id,
      workspaceId,
      fromProjectId: child.project_id,
      toProjectId,
      actorUserId,
      movedWithParent: true,
    });
  }
}
