/**
 * GET  /api/workspace/rbac?workspaceId=<uuid>
 * PATCH /api/workspace/rbac?workspaceId=<uuid>  — update role labels / permission overrides
 */

import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import {
    buildRbacConfigPatch,
    mergeRbacConfig,
    type WorkspaceRbacConfig,
    type WorkspaceRbacRoleOverride,
} from '@/lib/rbac/config';
import { PERMISSION_DEFINITIONS, type PermissionKey } from '@/lib/rbac/permissions';
import { WORKSPACE_ROLES, isWorkspaceRole, type WorkspaceRole } from '@/lib/rbac/roles';
import {
    WorkspaceAccessError,
    memberPermissions,
    requireSessionUser,
    requireWorkspaceMember,
    requireWorkspacePermission,
} from '@/lib/rbac/workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function accessErrorResponse(e: unknown) {
    if (e instanceof WorkspaceAccessError) {
        const status = e.message === 'Unauthorized' ? 401 : 403;
        return NextResponse.json({ error: e.message }, { status });
    }
    return null;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    if (!workspaceId || !UUID_RE.test(workspaceId)) {
        return NextResponse.json({ error: 'Missing or invalid workspaceId' }, { status: 400 });
    }

    try {
        const user = await requireSessionUser(request);
        const membership = await requireWorkspaceMember(workspaceId, user.id);
        const canManage = memberPermissions(membership).includes('manage_roles');

        const wsResult = await query<{ rbac_config: WorkspaceRbacConfig | null }>(
            `SELECT rbac_config FROM ${SCHEMA}.workspaces WHERE id = $1 LIMIT 1`,
            [workspaceId],
        );
        const rbacConfig = wsResult.rows[0]?.rbac_config ?? null;
        const roles = mergeRbacConfig(rbacConfig);

        const matrix = PERMISSION_DEFINITIONS.map((def) => ({
            id: def.key,
            name: def.name,
            description: def.description,
            section: def.section,
            roles: WORKSPACE_ROLES.reduce(
                (acc, role) => {
                    acc[role] = roles[role].permissions[def.key];
                    return acc;
                },
                {} as Record<WorkspaceRole, boolean>,
            ),
        }));

        return NextResponse.json({
            data: {
                roles: WORKSPACE_ROLES.map((key) => ({
                    key,
                    label: roles[key].label,
                    description: roles[key].description,
                    active: roles[key].active,
                    permissions: roles[key].permissions,
                })),
                matrix,
                canManage,
                myPermissions: memberPermissions(membership),
                myRole: membership.role,
                isOwner: membership.isOwner,
            },
        });
    } catch (e: unknown) {
        const handled = accessErrorResponse(e);
        if (handled) return handled;
        console.error('GET /api/workspace/rbac', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    if (!workspaceId || !UUID_RE.test(workspaceId)) {
        return NextResponse.json({ error: 'Missing or invalid workspaceId' }, { status: 400 });
    }

    let body: {
        role?: string;
        label?: string;
        description?: string;
        active?: boolean;
        permissions?: Partial<Record<PermissionKey, boolean>>;
        resetRole?: boolean;
    };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const roleKey = body.role;
    if (!roleKey || !isWorkspaceRole(roleKey)) {
        return NextResponse.json({ error: 'Valid role is required' }, { status: 400 });
    }

    try {
        const user = await requireSessionUser(request);
        await requireWorkspacePermission(workspaceId, user.id, 'manage_roles');

        const wsResult = await query<{ rbac_config: WorkspaceRbacConfig | null }>(
            `SELECT rbac_config FROM ${SCHEMA}.workspaces WHERE id = $1 LIMIT 1`,
            [workspaceId],
        );
        const current = wsResult.rows[0]?.rbac_config ?? null;

        let nextConfig: WorkspaceRbacConfig;
        if (body.resetRole) {
            const { [roleKey]: _removed, ...rest } = current?.roles ?? {};
            nextConfig = Object.keys(rest).length ? { roles: rest as WorkspaceRbacConfig['roles'] } : {};
        } else {
            const patch: WorkspaceRbacRoleOverride = {};
            if (typeof body.label === 'string') patch.label = body.label.trim();
            if (typeof body.description === 'string') patch.description = body.description.trim();
            if (typeof body.active === 'boolean') patch.active = body.active;
            if (body.permissions && typeof body.permissions === 'object') {
                patch.permissions = body.permissions;
            }
            nextConfig = buildRbacConfigPatch(current, roleKey, patch);
        }

        await query(
            `UPDATE ${SCHEMA}.workspaces SET rbac_config = $2::jsonb WHERE id = $1`,
            [workspaceId, JSON.stringify(nextConfig)],
        );

        const roles = mergeRbacConfig(nextConfig);
        return NextResponse.json({
            data: {
                role: {
                    key: roleKey,
                    label: roles[roleKey].label,
                    description: roles[roleKey].description,
                    active: roles[roleKey].active,
                    permissions: roles[roleKey].permissions,
                },
            },
        });
    } catch (e: unknown) {
        const handled = accessErrorResponse(e);
        if (handled) return handled;
        console.error('PATCH /api/workspace/rbac', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
