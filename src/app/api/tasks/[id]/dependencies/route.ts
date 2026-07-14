import { query, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireTaskRead, requireTaskWrite } from '@/lib/rbac/task-access';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const [user, { id: taskId }] = await Promise.all([requireSessionUser(request), params]);

        const result = await query(
            `SELECT td.*,
                    json_build_object('id', t.id, 'title', t.title, 'status', t.status) as depends_on
             FROM ${SCHEMA}.task_dependencies td
             LEFT JOIN ${SCHEMA}.tasks t ON t.id = td.depends_on_task_id
             WHERE td.task_id = $1
               AND EXISTS (
                 SELECT 1 FROM ${SCHEMA}.tasks tk
                 JOIN ${SCHEMA}.workspace_members wm ON wm.workspace_id = tk.workspace_id AND wm.user_id = $2
                 WHERE tk.id = $1
               )`,
            [taskId, user.id],
        );
        return NextResponse.json(result.rows);
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

        const { depends_on_task_id } = await request.json();
        await requireTaskRead(depends_on_task_id, user.id);

        const result = await query(
            `INSERT INTO ${SCHEMA}.task_dependencies (task_id, depends_on_task_id)
             VALUES ($1, $2) RETURNING *`,
            [taskId, depends_on_task_id],
        );
        return NextResponse.json(result.rows[0]);
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
        const depId = searchParams.get('depId');
        if (!depId) return NextResponse.json({ error: 'depId required' }, { status: 400 });

        await query(
            `DELETE FROM ${SCHEMA}.task_dependencies WHERE id = $1 AND task_id = $2`,
            [depId, taskId],
        );
        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
