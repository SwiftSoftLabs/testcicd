import { query, SCHEMA } from '@/lib/db';
import { insertTask } from '@/lib/tasks/insertTask';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import { NextResponse } from 'next/server';
import { canReceiveTaskNotification } from '@/lib/notification-preferences';
import { toAccessResponse } from '@/lib/rbac/http';
import {
    requireWorkspaceTasksRead,
} from '@/lib/rbac/task-access';
import { requireSessionUser, requireWorkspaceMember } from '@/lib/rbac/workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspaceId');

        if (!workspaceId || !UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
        }

        await requireWorkspaceTasksRead(workspaceId, user.id);

        const result = await query(
            `SELECT * FROM ${SCHEMA}.tasks WHERE workspace_id = $1 ORDER BY created_at DESC`,
            [workspaceId],
        );
        return NextResponse.json(result.rows);
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const body = await request.json() as { workspace_id?: string; status?: string; completed_at?: string | null; project_id?: string | null };
        const workspaceId = body.workspace_id;

        if (!workspaceId || !UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
        }

        if (body.status === 'done') {
            body.completed_at = body.completed_at ?? new Date().toISOString();
        } else if (!('completed_at' in body)) {
            body.completed_at = null;
        }

        await requireWorkspaceMember(workspaceId, user.id);
        await assertProjectWritable(body.project_id);

        const createdTask = await insertTask(body as Record<string, unknown>);
        const assigneeId = createdTask?.assignee_id as string | undefined;
        const taskId = createdTask?.id as string | undefined;
        const title = (createdTask?.title as string | undefined) || 'You were assigned a task';

        if (assigneeId && taskId) {
            const canNotify = await canReceiveTaskNotification(assigneeId, 'taskAssignments');
            if (canNotify) {
                await query(
                    `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [assigneeId, 'New task assigned', title, 'assignment', taskId],
                );
            }
        }

        return NextResponse.json(createdTask);
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
