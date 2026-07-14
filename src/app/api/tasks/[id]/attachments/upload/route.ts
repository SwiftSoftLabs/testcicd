import { NextResponse } from 'next/server';
import { query, SCHEMA, buildInsert } from '@/lib/db';
import { createClient } from '@/lib/insforge/server';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireTaskWrite } from '@/lib/rbac/task-access';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

const BUCKET = 'task-attachments';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
    const user = await requireSessionUser(request);
    const { id: taskId } = await params;
    await requireTaskWrite(taskId, user.id);

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const client = await createClient();
    const path = `${taskId}/${Date.now()}-${file.name}`;

    const { error: storageError } = await client.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false });

    if (storageError) {
        return NextResponse.json({ error: storageError.message }, { status: 500 });
    }

    try {
        const { sql, params: insertParams } = buildInsert(`${SCHEMA}.task_attachments`, {
            task_id: taskId,
            uploaded_by: user.id,
            file_name: file.name,
            file_size: file.size,
            file_type: file.type,
            storage_path: path,
        });
        const insertRes = await query(sql, insertParams);

        const countRes = await query<{ count: string }>(
            `SELECT COUNT(*) as count FROM ${SCHEMA}.task_attachments WHERE task_id = $1`,
            [taskId],
        );
        const count = parseInt(countRes.rows[0]?.count ?? '0', 10);
        await query(`UPDATE ${SCHEMA}.tasks SET attachment_count = $1 WHERE id = $2`, [count, taskId]);

        return NextResponse.json(insertRes.rows[0]);
    } catch (e: unknown) {
        await client.storage.from(BUCKET).remove([path]);
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
