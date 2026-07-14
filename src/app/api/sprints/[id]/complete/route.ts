import { query, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import { toAccessResponse } from '@/lib/rbac/http';
import {
    memberCan,
    requireSessionUser,
    requireWorkspaceMember,
    WorkspaceAccessError,
} from '@/lib/rbac/workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const completeBodySchema = z.object({
    action: z.enum(['backlog', 'next-sprint']),
    nextSprintId: z.string().uuid().optional(),
});

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id: sprintId } = await params;

        if (!UUID_RE.test(sprintId)) {
            return NextResponse.json({ error: 'Invalid sprint id' }, { status: 400 });
        }

        const sprintRes = await query<{ workspace_id: string; project_id: string | null }>(
            `SELECT workspace_id, project_id FROM ${SCHEMA}.sprints WHERE id = $1 LIMIT 1`,
            [sprintId],
        );
        const sprint = sprintRes.rows[0];
        const workspaceId = sprint?.workspace_id;
        if (!workspaceId) {
            return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });
        }

        const membership = await requireWorkspaceMember(workspaceId, user.id);
        if (!memberCan(membership, 'manage_workflows')) {
            return NextResponse.json({ error: 'You do not have permission to manage sprints.' }, { status: 403 });
        }
        await assertProjectWritable(sprint.project_id);

        const raw = await request.json();
        const parsed = completeBodySchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join('; ') }, { status: 400 });
        }
        const { action, nextSprintId } = parsed.data;

        await query(
            `UPDATE ${SCHEMA}.sprints SET status = 'completed' WHERE id = $1`,
            [sprintId],
        );

        const incompleteRes = await query<{ id: string }>(
            `SELECT id FROM ${SCHEMA}.tasks WHERE sprint_id = $1 AND status != 'done'`,
            [sprintId],
        );

        const ids = incompleteRes.rows.map(r => r.id);
        if (ids.length > 0) {
            if (action === 'next-sprint' && nextSprintId) {
                await query(
                    `UPDATE ${SCHEMA}.tasks SET sprint_id = $1 WHERE id = ANY($2::uuid[])`,
                    [nextSprintId, ids],
                );
            } else {
                await query(
                    `UPDATE ${SCHEMA}.tasks SET status = 'backlog' WHERE id = ANY($1::uuid[])`,
                    [ids],
                );
            }
        }

        return NextResponse.json({ success: true, movedCount: ids.length });
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
