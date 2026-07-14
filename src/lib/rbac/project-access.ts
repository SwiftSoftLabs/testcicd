import { query, SCHEMA } from '@/lib/db';
import type { PermissionKey } from './permissions';
import {
    memberCan,
    requireWorkspaceMember,
    WorkspaceAccessError,
    type WorkspaceMembership,
} from './workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertProjectUuid(projectId: string): void {
    if (!UUID_RE.test(projectId)) {
        throw new WorkspaceAccessError('Invalid project id.');
    }
}

export async function getProjectWorkspaceId(projectId: string): Promise<string | null> {
    assertProjectUuid(projectId);
    const res = await query<{ workspace_id: string }>(
        `SELECT workspace_id FROM ${SCHEMA}.projects WHERE id = $1 LIMIT 1`,
        [projectId],
    );
    return res.rows[0]?.workspace_id ?? null;
}

export async function requireProjectPermission(
    projectId: string,
    userId: string,
    permission: PermissionKey,
): Promise<{ workspaceId: string; membership: WorkspaceMembership }> {
    const workspaceId = await getProjectWorkspaceId(projectId);
    if (!workspaceId) {
        throw new WorkspaceAccessError('Project not found.');
    }
    const membership = await requireWorkspaceMember(workspaceId, userId);
    if (!memberCan(membership, permission)) {
        throw new WorkspaceAccessError('You do not have permission to perform this action.');
    }
    return { workspaceId, membership };
}

export async function requireProjectRepositoriesRead(
    projectId: string,
    userId: string,
): Promise<{ workspaceId: string; membership: WorkspaceMembership }> {
    return requireProjectPermission(projectId, userId, 'access_repositories');
}

export async function getPullRequestProjectId(prId: string): Promise<string | null> {
    if (!UUID_RE.test(prId)) {
        throw new WorkspaceAccessError('Invalid pull request id.');
    }
    const res = await query<{ project_id: string }>(
        `SELECT project_id FROM ${SCHEMA}.pull_requests WHERE id = $1 LIMIT 1`,
        [prId],
    );
    return res.rows[0]?.project_id ?? null;
}
