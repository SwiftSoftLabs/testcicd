import { query, buildSet, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import { pushTaskUpdateIfLinked } from '@/lib/plugins/tasks/sync-engine';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireTasksWrite } from '@/lib/rbac/task-access';
import { requireSessionUser } from '@/lib/rbac/workspace-access';
import { logTaskSystemActivity } from '@/lib/tasks/logTaskSystemActivity';
import {
    cascadeSubtasksOnProjectMove,
    reassignTaskKeyOnMove,
} from '@/lib/tasks/reassignTaskKeyOnMove';
import { formatStatusLabel } from '@/lib/tasks/taskKey';

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { ids, updates } = await request.json();

        if (!Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
        }

        await requireTasksWrite(ids, user.id);

        const targetProjectId =
            typeof updates?.projectId === 'string'
                ? updates.projectId
                : typeof updates?.project_id === 'string'
                  ? updates.project_id
                  : null;

        const hasProjectMove = Boolean(targetProjectId);

        const dbUpdates: Record<string, unknown> = {};
        if ('status' in updates) dbUpdates.status = updates.status;
        if (updates.status === 'done') dbUpdates.completed_at = new Date().toISOString();
        if ('status' in updates && updates.status !== 'done') dbUpdates.completed_at = null;
        if ('priority' in updates) dbUpdates.priority = updates.priority;
        if ('assigneeId' in updates) dbUpdates.assignee_id = updates.assigneeId;
        if ('sprintId' in updates) dbUpdates.sprint_id = updates.sprintId;
        if ('tags' in updates) dbUpdates.tags = updates.tags;

        if (!Object.keys(dbUpdates).length && !hasProjectMove) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        if (hasProjectMove && targetProjectId) {
            await assertProjectWritable(targetProjectId);

            const taskRows = await query<{
                id: string;
                workspace_id: string;
                project_id: string | null;
            }>(
                `SELECT id, workspace_id, project_id FROM ${SCHEMA}.tasks WHERE id = ANY($1::uuid[])`,
                [ids],
            );

            for (const row of taskRows.rows) {
                if (row.project_id === targetProjectId) continue;
                await reassignTaskKeyOnMove({
                    taskId: row.id,
                    workspaceId: row.workspace_id,
                    fromProjectId: row.project_id,
                    toProjectId: targetProjectId,
                    actorUserId: user.id,
                });
                await cascadeSubtasksOnProjectMove(
                    row.id,
                    row.workspace_id,
                    targetProjectId,
                    user.id,
                );
            }
        }

        if (!Object.keys(dbUpdates).length) {
            const moved = await query(
                `SELECT * FROM ${SCHEMA}.tasks WHERE id = ANY($1::uuid[])`,
                [ids],
            );
            return NextResponse.json({ data: moved.rows, updated: moved.rows.length });
        }

        const previousRows =
            'status' in dbUpdates
                ? await query<{ id: string; status: string }>(
                      `SELECT id, status FROM ${SCHEMA}.tasks WHERE id = ANY($1::uuid[])`,
                      [ids],
                  )
                : { rows: [] as { id: string; status: string }[] };

        const previousById = new Map(
            previousRows.rows.map((r) => [r.id, r.status]),
        );

        const { clause, params: setParams, nextIdx } = buildSet(dbUpdates);

        const result = await query(
            `UPDATE ${SCHEMA}.tasks SET ${clause} WHERE id = ANY($${nextIdx}::uuid[]) RETURNING *`,
            [...setParams, ids],
        );

        if ('status' in dbUpdates) {
            const actorRes = await query<{ full_name: string | null }>(
                `SELECT full_name FROM ${SCHEMA}.profiles WHERE id = $1 LIMIT 1`,
                [user.id],
            );
            const actor = actorRes.rows[0]?.full_name ?? 'Someone';
            const nextStatus = dbUpdates.status as string;

            for (const row of result.rows) {
                const taskId = (row as { id?: string }).id;
                if (!taskId) continue;

                const previousStatus = previousById.get(taskId);
                if (previousStatus && previousStatus !== nextStatus) {
                    await logTaskSystemActivity({
                        taskId,
                        actorUserId: user.id,
                        content: `${actor} changed status from ${formatStatusLabel(previousStatus)} to ${formatStatusLabel(nextStatus)}.`,
                    });
                }

                try {
                    await pushTaskUpdateIfLinked(taskId);
                } catch {
                    /* external push is best-effort */
                }
            }
        }

        return NextResponse.json({ data: result.rows, updated: result.rows.length });
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
