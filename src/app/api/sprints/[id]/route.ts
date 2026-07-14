import { query, buildSet, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import { toAccessResponse } from '@/lib/rbac/http';
import {
    memberCan,
    requireSessionUser,
    requireWorkspaceMember,
    WorkspaceAccessError,
} from '@/lib/rbac/workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireSprintWorkflowAccess(sprintId: string, userId: string) {
    if (!UUID_RE.test(sprintId)) {
        throw new WorkspaceAccessError('Invalid sprint id');
    }

    const sprintRes = await query<{ workspace_id: string; project_id: string | null }>(
        `SELECT workspace_id, project_id FROM ${SCHEMA}.sprints WHERE id = $1 LIMIT 1`,
        [sprintId],
    );
    const sprint = sprintRes.rows[0];
    const workspaceId = sprint?.workspace_id;
    if (!workspaceId) {
        throw new WorkspaceAccessError('Sprint not found');
    }

    const membership = await requireWorkspaceMember(workspaceId, userId);
    if (!memberCan(membership, 'manage_workflows')) {
        throw new WorkspaceAccessError('You do not have permission to manage sprints.');
    }
    await assertProjectWritable(sprint.project_id);
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;
        await requireSprintWorkflowAccess(id, user.id);

        const body = await request.json();
        const { clause, params: setParams, nextIdx } = buildSet(body);
        if (!clause) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

        const result = await query(
            `UPDATE ${SCHEMA}.sprints SET ${clause} WHERE id = $${nextIdx} RETURNING *`,
            [...setParams, id],
        );
        if (!result.rows[0]) return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });
        return NextResponse.json(result.rows[0]);
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : e.message === 'Sprint not found' ? 404 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(_request);
        const { id } = await params;
        await requireSprintWorkflowAccess(id, user.id);

        await query(`DELETE FROM ${SCHEMA}.sprints WHERE id = $1`, [id]);
        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : e.message === 'Sprint not found' ? 404 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
