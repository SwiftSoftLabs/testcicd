/**
 * PATCH /api/workspace/members/[id]/role?workspaceId=<uuid>
 * Body: { role: "Admin" | "Team Lead" | "Member" | "Guest" }
 */

import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { roleFromUILabel, roleToUILabel } from '@/lib/rbac/roles';
import {
    WorkspaceAccessError,
    requireSessionUser,
    requireWorkspacePermission,
} from '@/lib/rbac/workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
    const caller = await requireSessionUser(request).catch(() => null);
    if (!caller) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: targetUserId } = await params;
    if (!targetUserId || !UUID_RE.test(targetUserId)) {
        return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    if (!workspaceId || !UUID_RE.test(workspaceId)) {
        return NextResponse.json({ error: 'Missing or invalid workspaceId' }, { status: 400 });
    }

    let body: { role?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.role) {
        return NextResponse.json({ error: 'role is required' }, { status: 400 });
    }

    if (targetUserId === caller.id) {
        return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 });
    }

    try {
        await requireWorkspacePermission(workspaceId, caller.id, 'manage_members');

        const ownerCheck = await query<{ owner_id: string | null }>(
            `SELECT owner_id FROM ${SCHEMA}.workspaces WHERE id = $1 LIMIT 1`,
            [workspaceId],
        );
        if (ownerCheck.rows[0]?.owner_id === targetUserId) {
            return NextResponse.json({ error: 'Cannot change the workspace owner role.' }, { status: 400 });
        }

        const dbRole = roleFromUILabel(body.role);
        await query(
            `UPDATE ${SCHEMA}.workspace_members
             SET role = $3
             WHERE workspace_id = $1 AND user_id = $2`,
            [workspaceId, targetUserId, dbRole],
        );

        return NextResponse.json({
            data: { role: roleToUILabel(dbRole) },
            message: 'Role updated.',
        });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            return NextResponse.json({ error: e.message }, { status: 403 });
        }
        console.error('PATCH member role', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
