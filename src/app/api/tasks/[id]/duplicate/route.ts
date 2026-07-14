import { query, SCHEMA } from '@/lib/db';
import { insertTask } from '@/lib/tasks/insertTask';
import { NextResponse } from 'next/server';
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

        const fetchRes = await query(
            `SELECT * FROM ${SCHEMA}.tasks WHERE id = $1 LIMIT 1`,
            [taskId],
        );
        const task = fetchRes.rows[0] as Record<string, unknown> | undefined;
        if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

        const {
            id: _id,
            created_at: _ca,
            updated_at: _ua,
            task_number: _tn,
            task_key: _tk,
            ...taskData
        } = task;
        void _id; void _ca; void _ua; void _tn; void _tk;

        const duplicate = {
            ...taskData,
            title: `${taskData.title} (Copy)`,
            assigner_id: user.id,
        };
        const created = await insertTask(duplicate);

        return NextResponse.json(created);
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
