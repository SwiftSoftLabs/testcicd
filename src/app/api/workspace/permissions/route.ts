/**
 * GET /api/workspace/permissions?workspaceId=<uuid>
 * Current user's resolved permission keys for the workspace.
 */

import { NextResponse } from 'next/server';
import {
    WorkspaceAccessError,
    memberPermissions,
    requireSessionUser,
    requireWorkspaceMember,
} from '@/lib/rbac/workspace-access';
import { roleToUILabel } from '@/lib/rbac/roles';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    if (!workspaceId || !UUID_RE.test(workspaceId)) {
        return NextResponse.json({ error: 'Missing or invalid workspaceId' }, { status: 400 });
    }

    try {
        const user = await requireSessionUser(request);
        const membership = await requireWorkspaceMember(workspaceId, user.id);
        return NextResponse.json({
            data: {
                permissions: memberPermissions(membership),
                role: membership.role,
                roleLabel: roleToUILabel(membership.role),
                isOwner: membership.isOwner,
            },
        });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
