import { query, SCHEMA } from '@/lib/db';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import {
    getWorkspaceMembership,
    type WorkspaceMembership,
} from '@/lib/rbac/workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TaskAccessError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TaskAccessError';
    }
}

export function assertUuid(id: string, label = 'id'): void {
    if (!UUID_RE.test(id)) {
        throw new TaskAccessError(`Invalid ${label}.`);
    }
}

export async function getTaskWorkspaceId(taskId: string): Promise<string | null> {
    assertUuid(taskId, 'task id');
    const res = await query<{ workspace_id: string }>(
        `SELECT workspace_id FROM ${SCHEMA}.tasks WHERE id = $1 LIMIT 1`,
        [taskId],
    );
    return res.rows[0]?.workspace_id ?? null;
}

export async function getTaskProjectId(taskId: string): Promise<string | null> {
    assertUuid(taskId, 'task id');
    const res = await query<{ project_id: string | null }>(
        `SELECT project_id FROM ${SCHEMA}.tasks WHERE id = $1 LIMIT 1`,
        [taskId],
    );
    return res.rows[0]?.project_id ?? null;
}

export async function requireWorkspaceTasksRead(
    workspaceId: string,
    userId: string,
): Promise<WorkspaceMembership> {
    assertUuid(workspaceId, 'workspace id');
    assertUuid(userId, 'user id');
    const membership = await getWorkspaceMembership(workspaceId, userId);
    if (!membership) {
        throw new TaskAccessError('You are not a member of this workspace.');
    }
    return membership;
}

export async function requireWorkspaceTasksWrite(
    workspaceId: string,
    userId: string,
): Promise<WorkspaceMembership> {
    return requireWorkspaceTasksRead(workspaceId, userId);
}

export async function requireTaskRead(
    taskId: string,
    userId: string,
): Promise<{ workspaceId: string; membership: WorkspaceMembership }> {
    const workspaceId = await getTaskWorkspaceId(taskId);
    if (!workspaceId) {
        throw new TaskAccessError('Task not found.');
    }
    const membership = await requireWorkspaceTasksRead(workspaceId, userId);
    return { workspaceId, membership };
}

export async function requireTaskWrite(
    taskId: string,
    userId: string,
): Promise<{ workspaceId: string; membership: WorkspaceMembership }> {
    const [workspaceId, projectId] = await Promise.all([
        getTaskWorkspaceId(taskId),
        getTaskProjectId(taskId),
    ]);
    if (!workspaceId) {
        throw new TaskAccessError('Task not found.');
    }
    const membership = await requireWorkspaceTasksWrite(workspaceId, userId);
    await assertProjectWritable(projectId);
    return { workspaceId, membership };
}

/** Bulk reads — all tasks must belong to one workspace the user is a member of. */
export async function requireTasksRead(
    taskIds: string[],
    userId: string,
): Promise<{ workspaceId: string; membership: WorkspaceMembership }> {
    if (taskIds.length === 0) {
        throw new TaskAccessError('ids array is required');
    }
    for (const id of taskIds) assertUuid(id, 'task id');

    const res = await query<{ workspace_id: string }>(
        `SELECT DISTINCT workspace_id FROM ${SCHEMA}.tasks WHERE id = ANY($1::uuid[])`,
        [taskIds],
    );
    if (res.rows.length === 0) {
        throw new TaskAccessError('No tasks found.');
    }
    if (res.rows.length > 1) {
        throw new TaskAccessError('Tasks must belong to the same workspace.');
    }
    const workspaceId = res.rows[0].workspace_id;
    const membership = await requireWorkspaceTasksRead(workspaceId, userId);
    return { workspaceId, membership };
}

/** Bulk updates — all tasks must belong to one workspace the user can write. */
export async function requireTasksWrite(
    taskIds: string[],
    userId: string,
): Promise<{ workspaceId: string; membership: WorkspaceMembership }> {
    if (taskIds.length === 0) {
        throw new TaskAccessError('ids array is required');
    }
    for (const id of taskIds) assertUuid(id, 'task id');

    const res = await query<{ workspace_id: string; project_id: string | null }>(
        `SELECT DISTINCT workspace_id, project_id FROM ${SCHEMA}.tasks WHERE id = ANY($1::uuid[])`,
        [taskIds],
    );
    if (res.rows.length === 0) {
        throw new TaskAccessError('No tasks found.');
    }
    const workspaceIds = Array.from(new Set(res.rows.map((row) => row.workspace_id)));
    if (workspaceIds.length > 1) {
        throw new TaskAccessError('Tasks must belong to the same workspace.');
    }
    const workspaceId = workspaceIds[0];
    const membership = await requireWorkspaceTasksWrite(workspaceId, userId);
    const projectIds = Array.from(new Set(res.rows.map((row) => row.project_id).filter(Boolean)));
    await Promise.all(projectIds.map((projectId) => assertProjectWritable(projectId)));
    return { workspaceId, membership };
}
