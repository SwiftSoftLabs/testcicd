import { query, SCHEMA } from '@/lib/db';
import { assertTaskWritable } from '@/lib/billing/quota-locks';
import { NextResponse } from 'next/server';
import { canReceiveTaskNotification } from '@/lib/notification-preferences';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireTaskRead } from '@/lib/rbac/task-access';
import { requireSessionUser } from '@/lib/rbac/workspace-access';
import { z } from 'zod';

const postActivitySchema = z.object({
    type: z.enum(['comment', 'comment_image']).default('comment'),
    content: z.string().min(1, 'Content is required'),
});

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id: taskId } = await params;

        const result = await query(
            `SELECT ta.*,
                    json_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url) as profiles,
                    (ta.user_id = $2) as is_own
             FROM ${SCHEMA}.task_activities ta
             LEFT JOIN ${SCHEMA}.profiles p ON p.id = ta.user_id
             WHERE ta.task_id = $1
               AND EXISTS (
                 SELECT 1 FROM ${SCHEMA}.tasks t
                 JOIN ${SCHEMA}.workspace_members wm
                   ON wm.workspace_id = t.workspace_id AND wm.user_id = $2
                 WHERE t.id = $1
               )
             ORDER BY ta.created_at ASC`,
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
        const [user, { id: taskId }, raw] = await Promise.all([
            requireSessionUser(request),
            params,
            request.json().catch(() => ({})),
        ]);

        const parsed = postActivitySchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join('; ') }, { status: 400 });
        }
        const { type: activityType, content } = parsed.data;

        const profileRes = await query<{ full_name: string; avatar_url: string }>(
            `SELECT full_name, avatar_url FROM ${SCHEMA}.profiles WHERE id = $1 LIMIT 1`,
            [user.id],
        );

        await Promise.all([
            requireTaskRead(taskId, user.id),
            assertTaskWritable(taskId),
        ]);
        const profile = profileRes.rows[0];

        const [insertRes, taskRes] = await Promise.all([
            query(
                `INSERT INTO ${SCHEMA}.task_activities (task_id, user_id, type, content)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [taskId, user.id, activityType, content],
            ),
            query<Record<string, unknown>>(
                `SELECT id, title, assignee_id FROM ${SCHEMA}.tasks WHERE id = $1 LIMIT 1`,
                [taskId],
            ),
        ]);

        const task = taskRes.rows[0];
        const assigneeId = task?.assignee_id as string | undefined;
        if (assigneeId && assigneeId !== user.id && (activityType === 'comment' || activityType === 'comment_image')) {
            const canNotify = await canReceiveTaskNotification(assigneeId, 'taskComments');
            if (canNotify) {
                await query(
                    `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [
                        assigneeId,
                        'New comment on your task',
                        (task?.title as string | undefined) || 'A task has a new comment',
                        'comment',
                        taskId,
                    ],
                );
            }
        }

        return NextResponse.json({
            ...insertRes.rows[0],
            profiles: profile ? { id: user.id, full_name: profile.full_name, avatar_url: profile.avatar_url } : null,
        });
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
