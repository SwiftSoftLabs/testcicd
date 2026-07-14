import { query, buildSet, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import { canReceiveTaskNotification } from '@/lib/notification-preferences';
import { toAccessResponse } from '@/lib/rbac/http';
import { assertTaskDeletableInOneWork, PluginSourcedTaskError } from '@/lib/plugins/tasks/task-guard';
import { pushTaskUpdateIfLinked } from '@/lib/plugins/tasks/sync-engine';
import { requireTaskRead, requireTaskWrite } from '@/lib/rbac/task-access';
import { requireSessionUser } from '@/lib/rbac/workspace-access';
import { logTaskSystemActivity } from '@/lib/tasks/logTaskSystemActivity';
import {
    cascadeSubtasksOnProjectMove,
    reassignTaskKeyOnMove,
} from '@/lib/tasks/reassignTaskKeyOnMove';
import { formatStatusLabel } from '@/lib/tasks/taskKey';

function projectScopeChanged(
    current: string | null | undefined,
    incoming: string | null | undefined,
    bodyHasProjectId: boolean,
): boolean {
    if (!bodyHasProjectId) return false;
    const a = current ?? null;
    const b = incoming ?? null;
    return a !== b;
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;
        await requireTaskRead(id, user.id);

        const taskRes = await query(
            `SELECT * FROM ${SCHEMA}.tasks WHERE id = $1 LIMIT 1`,
            [id],
        );
        if (!taskRes.rows[0]) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        const actRes = await query(
            `SELECT * FROM ${SCHEMA}.task_activities WHERE task_id = $1 ORDER BY created_at ASC`,
            [id],
        );

        const task = { ...taskRes.rows[0], task_activities: actRes.rows };
        return NextResponse.json(task);
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;
        const body = (await request.json()) as Record<string, unknown>;
        await requireTaskWrite(id, user.id);

        if ('task_key' in body || 'task_number' in body) {
            return NextResponse.json(
                { error: 'task_key and task_number cannot be set directly' },
                { status: 400 },
            );
        }

        const previousTask = await query<Record<string, unknown>>(
            `SELECT id, title, assignee_id, status, project_id, workspace_id
             FROM ${SCHEMA}.tasks WHERE id = $1 LIMIT 1`,
            [id],
        );
        const prev = previousTask.rows[0];
        if (!prev) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        const currentProjectId = (prev.project_id as string | null | undefined) ?? null;
        const workspaceId = prev.workspace_id as string;
        const bodyHasProjectId = 'project_id' in body;
        const incomingProjectId = bodyHasProjectId
            ? ((body.project_id as string | null | undefined) ?? null)
            : currentProjectId;

        if (incomingProjectId && incomingProjectId !== currentProjectId) {
            await assertProjectWritable(incomingProjectId);
        }

        if (projectScopeChanged(currentProjectId, incomingProjectId, bodyHasProjectId)) {
            await reassignTaskKeyOnMove({
                taskId: id,
                workspaceId,
                fromProjectId: currentProjectId,
                toProjectId: incomingProjectId,
                actorUserId: user.id,
            });
            await cascadeSubtasksOnProjectMove(
                id,
                workspaceId,
                incomingProjectId,
                user.id,
            );
            delete body.project_id;
        }

        if (body.status === 'done') {
            body.completed_at = body.completed_at ?? new Date().toISOString();
        } else if (body.status) {
            body.completed_at = null;
        }

        const previousStatus = prev.status as string | undefined;
        const statusChanging =
            'status' in body &&
            typeof body.status === 'string' &&
            body.status !== previousStatus;

        const { clause, params: setParams, nextIdx } = buildSet(body);
        let updatedTask: Record<string, unknown>;

        if (clause) {
            const result = await query(
                `UPDATE ${SCHEMA}.tasks SET ${clause} WHERE id = $${nextIdx} RETURNING *`,
                [...setParams, id],
            );
            if (!result.rows[0]) {
                return NextResponse.json({ error: 'Task not found' }, { status: 404 });
            }
            updatedTask = result.rows[0] as Record<string, unknown>;
        } else if (bodyHasProjectId && projectScopeChanged(currentProjectId, incomingProjectId, true)) {
            const result = await query(
                `SELECT * FROM ${SCHEMA}.tasks WHERE id = $1 LIMIT 1`,
                [id],
            );
            updatedTask = result.rows[0] as Record<string, unknown>;
        } else {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        if (statusChanging) {
            const actorRes = await query<{ full_name: string | null }>(
                `SELECT full_name FROM ${SCHEMA}.profiles WHERE id = $1 LIMIT 1`,
                [user.id],
            );
            const actor = actorRes.rows[0]?.full_name ?? 'Someone';
            const nextStatus = updatedTask.status as string;
            await logTaskSystemActivity({
                taskId: id,
                actorUserId: user.id,
                content: `${actor} changed status from ${formatStatusLabel(previousStatus ?? '')} to ${formatStatusLabel(nextStatus)}.`,
            });
        }

        const previousAssignee = prev.assignee_id as string | undefined;
        const nextAssignee = updatedTask.assignee_id as string | undefined;
        const nextStatus = updatedTask.status as string | undefined;
        const title = (updatedTask.title as string | undefined) || 'Task update';

        if (nextAssignee && nextAssignee !== previousAssignee) {
            const canNotifyAssignment = await canReceiveTaskNotification(nextAssignee, 'taskAssignments');
            if (canNotifyAssignment) {
                await query(
                    `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [nextAssignee, 'Task assignment updated', title, 'assignment', id],
                );
            }
        }

        if (nextAssignee && previousStatus && nextStatus && previousStatus !== nextStatus) {
            const canNotifyStatus = await canReceiveTaskNotification(nextAssignee, 'taskStatusChanges');
            if (canNotifyStatus) {
                await query(
                    `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [nextAssignee, 'Task status changed', `${title} moved to ${nextStatus}`, 'system', id],
                );
            }
        }

        try {
            await pushTaskUpdateIfLinked(id);
        } catch {
            /* external push is best-effort */
        }

        return NextResponse.json(updatedTask);
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
        const { id } = await params;
        await requireTaskWrite(id, user.id);
        await assertTaskDeletableInOneWork(id);

        await query(`DELETE FROM ${SCHEMA}.tasks WHERE id = $1`, [id]);
        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof PluginSourcedTaskError) {
            return NextResponse.json({ error: e.message }, { status: 403 });
        }
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
