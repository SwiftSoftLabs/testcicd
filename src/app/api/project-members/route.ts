/**
 * POST /api/project-members
 * Assigns a user to a project (upserts role).
 */

import { NextResponse } from 'next/server';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import { query, SCHEMA } from '@/lib/db';
import { toAccessResponse } from '@/lib/rbac/http';
import {
    memberCan,
    requireSessionUser,
    requireWorkspaceMember,
    WorkspaceAccessError,
} from '@/lib/rbac/workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
    try {
        const caller = await requireSessionUser(request);

        let body: { projectId?: string; userId?: string; role?: string };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const { projectId, userId, role } = body;

        if (!projectId || !userId) {
            return NextResponse.json({ error: 'projectId and userId are required' }, { status: 400 });
        }

        if (!UUID_RE.test(projectId) || !UUID_RE.test(userId)) {
            return NextResponse.json({ error: 'Invalid projectId or userId' }, { status: 400 });
        }

        const projectRes = await query<{ workspace_id: string }>(
            `SELECT workspace_id FROM ${SCHEMA}.projects WHERE id = $1 LIMIT 1`,
            [projectId],
        );
        const workspaceId = projectRes.rows[0]?.workspace_id;
        if (!workspaceId) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        const membership = await requireWorkspaceMember(workspaceId, caller.id);
        if (!memberCan(membership, 'manage_members')) {
            return NextResponse.json({ error: 'You do not have permission to assign project members.' }, { status: 403 });
        }
        await assertProjectWritable(projectId);

        const targetMember = await query(
            `SELECT 1 FROM ${SCHEMA}.workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
            [workspaceId, userId],
        );
        if (targetMember.rowCount === 0) {
            return NextResponse.json({ error: 'User is not a member of this workspace.' }, { status: 400 });
        }

        const memberRole = role || 'member';

        await query(
            `INSERT INTO ${SCHEMA}.project_members (project_id, user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
            [projectId, userId, memberRole],
        );

        return NextResponse.json({ message: 'User assigned to project.' }, { status: 201 });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        if (error instanceof WorkspaceAccessError) {
            const status = error.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: error.message }, { status });
        }
        console.error('Error assigning project member:', error);
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
