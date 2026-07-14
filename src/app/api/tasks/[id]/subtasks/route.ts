import { query, SCHEMA } from '@/lib/db';
import { insertTask } from '@/lib/tasks/insertTask';
import { NextResponse } from 'next/server';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireTaskRead, requireTaskWrite } from '@/lib/rbac/task-access';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const [user, { id: parentId }] = await Promise.all([requireSessionUser(request), params]);

        const result = await query(
            `SELECT * FROM ${SCHEMA}.tasks
             WHERE parent_task_id = $1
               AND EXISTS (
                 SELECT 1 FROM ${SCHEMA}.tasks t
                 JOIN ${SCHEMA}.workspace_members wm ON wm.workspace_id = t.workspace_id AND wm.user_id = $2
                 WHERE t.id = $1
               )
             ORDER BY created_at ASC`,
            [parentId, user.id],
        );
        const mapped = result.rows.map((t: Record<string, unknown>) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            status: t.status,
            priority: t.priority,
            assigneeId: t.assignee_id,
            tags: t.tags || [],
            commentsCount: t.comments_count || 0,
            dueDate: t.due_date,
            parentTaskId: t.parent_task_id,
        }));
        return NextResponse.json(mapped);
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
        const { id: parentId } = await params;
        await requireTaskWrite(parentId, user.id);

        const body = await request.json() as Record<string, unknown>;
        const data = await insertTask({ ...body, parent_task_id: parentId });

        const siblingsRes = await query<{ status: string }>(
            `SELECT status FROM ${SCHEMA}.tasks WHERE parent_task_id = $1`,
            [parentId],
        );
        const total = siblingsRes.rows.length;
        const done = siblingsRes.rows.filter((r) => r.status === 'done').length;
        await query(
            `UPDATE ${SCHEMA}.tasks SET subtask_count = $1, subtask_done_count = $2 WHERE id = $3`,
            [total, done, parentId],
        );

        return NextResponse.json({
            id: data.id,
            title: data.title,
            status: data.status,
            priority: data.priority,
            assigneeId: data.assignee_id,
            tags: data.tags || [],
            commentsCount: 0,
            parentTaskId: parentId,
        });
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
