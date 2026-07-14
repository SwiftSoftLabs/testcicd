import { query, buildInsert, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireTaskRead, requireTaskWrite } from '@/lib/rbac/task-access';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id: taskId } = await params;
        await requireTaskRead(taskId, user.id);

        const [uploaded, linked] = await Promise.all([
            query(
                `SELECT *, 'upload' AS source FROM ${SCHEMA}.task_attachments WHERE task_id = $1 ORDER BY created_at DESC`,
                [taskId],
            ),
            query(
                `SELECT
                   tfl.id, tfl.task_id, tfl.linked_by AS uploaded_by,
                   wf.file_name, wf.file_size, wf.file_type, wf.storage_path, wf.created_at,
                   'workspace' AS source, wf.id AS workspace_file_id
                 FROM ${SCHEMA}.task_file_links tfl
                 JOIN ${SCHEMA}.workspace_files wf ON wf.id = tfl.workspace_file_id
                 WHERE tfl.task_id = $1
                 ORDER BY tfl.created_at DESC`,
                [taskId],
            ),
        ]);
        return NextResponse.json([...uploaded.rows, ...linked.rows]);
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id: taskId } = await params;
        await requireTaskWrite(taskId, user.id);

        const body = await request.json();
        const { sql, params: insertParams } = buildInsert(`${SCHEMA}.task_attachments`, { ...body, task_id: taskId });

        const insertRes = await query(sql, insertParams);

        const countRes = await query<{ count: string }>(
            `SELECT COUNT(*) as count FROM ${SCHEMA}.task_attachments WHERE task_id = $1`,
            [taskId],
        );
        const count = parseInt(countRes.rows[0]?.count ?? '0', 10);
        await query(`UPDATE ${SCHEMA}.tasks SET attachment_count = $1 WHERE id = $2`, [count, taskId]);

        return NextResponse.json(insertRes.rows[0]);
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
        const attachmentId = searchParams.get('attachmentId');
        if (!attachmentId) return NextResponse.json({ error: 'attachmentId required' }, { status: 400 });

        await query(
            `DELETE FROM ${SCHEMA}.task_attachments WHERE id = $1 AND task_id = $2`,
            [attachmentId, taskId],
        );

        const countRes = await query<{ count: string }>(
            `SELECT COUNT(*) as count FROM ${SCHEMA}.task_attachments WHERE task_id = $1`,
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
