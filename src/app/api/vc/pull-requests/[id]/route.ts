import { query, buildSet, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import {
    getPullRequestProjectId,
    requireProjectPermission,
    requireProjectRepositoriesRead,
} from '@/lib/rbac/project-access';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;
        const body = await request.json() as Record<string, unknown>;

        const projectId = await getPullRequestProjectId(id);
        if (!projectId) {
            return NextResponse.json({ error: 'PR not found' }, { status: 404 });
        }

        const isMergeAction =
            body.status === 'merged' ||
            body.is_merged === true ||
            body.merged === true;

        if (isMergeAction) {
            await requireProjectPermission(projectId, user.id, 'merge_pull_requests');
        } else {
            await requireProjectRepositoriesRead(projectId, user.id);
        }
        await assertProjectWritable(projectId);

        const { clause, params: setParams, nextIdx } = buildSet(body);
        if (!clause) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

        const result = await query(
            `UPDATE ${SCHEMA}.pull_requests SET ${clause} WHERE id = $${nextIdx} RETURNING *`,
            [...setParams, id],
        );
        if (!result.rows[0]) return NextResponse.json({ error: 'PR not found' }, { status: 404 });
        return NextResponse.json(result.rows[0]);
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
