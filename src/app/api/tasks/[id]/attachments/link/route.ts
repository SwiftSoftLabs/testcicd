import { NextResponse } from 'next/server';
import { query, SCHEMA, buildInsert } from '@/lib/db';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireTaskWrite } from '@/lib/rbac/task-access';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
    const user = await requireSessionUser(request);
    const { id: taskId } = await params;
    await requireTaskWrite(taskId, user.id);
    const body = await request.json() as { workspace_file_id?: string };
    const { workspace_file_id } = body;
    if (!workspace_file_id) return NextResponse.json({ error: 'workspace_file_id required' }, { status: 400 });

    const { sql, params: insertParams } = buildInsert(`${SCHEMA}.task_file_links`, {
        task_id: taskId,
        workspace_file_id,
        linked_by: user.id,
    });
    await query(sql, insertParams);

    const countRes = await query<{ count: string }>(
        `SELECT (
           (SELECT COUNT(*) FROM ${SCHEMA}.task_attachments WHERE task_id = $1) +
           (SELECT COUNT(*) FROM ${SCHEMA}.task_file_links WHERE task_id = $1)
         )::text AS count`,
        [taskId],
    );
    const count = parseInt(countRes.rows[0]?.count ?? '0', 10);
    await query(`UPDATE ${SCHEMA}.tasks SET attachment_count = $1 WHERE id = $2`, [count, taskId]);

    return NextResponse.json({ success: true }, { status: 201 });
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
    const user = await requireSessionUser(request);
    const { id: taskId } = await params;
    await requireTaskWrite(taskId, user.id);
    const { searchParams } = new URL(request.url);
    const workspaceFileId = searchParams.get('workspace_file_id');
    if (!workspaceFileId) return NextResponse.json({ error: 'workspace_file_id required' }, { status: 400 });

    await query(
        `DELETE FROM ${SCHEMA}.task_file_links WHERE task_id = $1 AND workspace_file_id = $2`,
        [taskId, workspaceFileId],
    );

    const countRes = await query<{ count: string }>(
        `SELECT (
           (SELECT COUNT(*) FROM ${SCHEMA}.task_attachments WHERE task_id = $1) +
           (SELECT COUNT(*) FROM ${SCHEMA}.task_file_links WHERE task_id = $1)
         )::text AS count`,
        [taskId],
    );
    const count = parseInt(countRes.rows[0]?.count ?? '0', 10);
    await query(`UPDATE ${SCHEMA}.tasks SET attachment_count = $1 WHERE id = $2`, [count, taskId]);

    return NextResponse.json({ success: true });
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
