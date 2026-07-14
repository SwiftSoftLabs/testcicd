import { query, SCHEMA, getUserFromRequest } from '@/lib/db';
import type { PermissionKey } from './permissions';
import {
    mergeRbacConfig,
    permissionsForMember,
    roleHasPermission,
    type WorkspaceRbacConfig,
} from './config';
import { isWorkspaceRole, type WorkspaceRole } from './roles';

export interface WorkspaceMembership {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    isOwner: boolean;
    rbacConfig: WorkspaceRbacConfig | null;
}

export class WorkspaceAccessError extends Error {
    status: number;
    constructor(message: string, status = 403) {
        super(message);
        this.name = 'WorkspaceAccessError';
        this.status = status;
    }
}

export async function getWorkspaceMembership(
    workspaceId: string,
    userId: string,
): Promise<WorkspaceMembership | null> {
    const result = await query<{
        role: string;
        owner_id: string | null;
        rbac_config: WorkspaceRbacConfig | null;
    }>(
        `SELECT wm.role, w.owner_id, w.rbac_config
         FROM ${SCHEMA}.workspace_members wm
         JOIN ${SCHEMA}.workspaces w ON w.id = wm.workspace_id
         WHERE wm.workspace_id = $1 AND wm.user_id = $2
         LIMIT 1`,
        [workspaceId, userId],
    );
    const row = result.rows[0];
    if (!row || !isWorkspaceRole(row.role)) return null;
    return {
        workspaceId,
        userId,
        role: row.role,
        isOwner: row.owner_id === userId,
        rbacConfig: row.rbac_config ?? null,
    };
}

export function memberCan(
    membership: WorkspaceMembership,
    permission: PermissionKey,
): boolean {
    if (membership.isOwner) return true;
    const resolved = mergeRbacConfig(membership.rbacConfig);
    return roleHasPermission(resolved, membership.role, permission);
}

export function memberPermissions(membership: WorkspaceMembership): PermissionKey[] {
    const resolved = mergeRbacConfig(membership.rbacConfig);
    return permissionsForMember(resolved, membership.role, membership.isOwner);
}

export async function requireSessionUser(request: Request) {
    const user = await getUserFromRequest(request);
    if (!user?.id) {
        throw new WorkspaceAccessError('Unauthorized', 401);
    }
    return user;
}

export async function requireWorkspaceMember(
    workspaceId: string,
    userId: string,
): Promise<WorkspaceMembership> {
    const membership = await getWorkspaceMembership(workspaceId, userId);
    if (!membership) {
        throw new WorkspaceAccessError('You are not a member of this workspace.');
    }
    return membership;
}

export async function requireWorkspacePermission(
    workspaceId: string,
    userId: string,
    permission: PermissionKey,
): Promise<WorkspaceMembership> {
    const membership = await requireWorkspaceMember(workspaceId, userId);
    if (!memberCan(membership, permission)) {
        throw new WorkspaceAccessError('You do not have permission to perform this action.');
    }
    return membership;
}

/** Owner or admin role (legacy checks) — prefer permission keys in new code. */
export function isWorkspaceAdmin(membership: WorkspaceMembership): boolean {
    return membership.isOwner || membership.role === 'admin';
}
