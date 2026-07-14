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
            `SELECT tl.*, p.full_name as user_full_name, p.avatar_url as user_avatar_url
             FROM ${SCHEMA}.task_time_logs tl
             LEFT JOIN ${SCHEMA}.profiles p ON p.id = tl.user_id
             WHERE tl.task_id = $1
               AND EXISTS (
                 SELECT 1 FROM ${SCHEMA}.tasks t
                 JOIN ${SCHEMA}.workspace_members wm ON wm.workspace_id = t.workspace_id AND wm.user_id = $2
                 WHERE t.id = $1
               )
             ORDER BY tl.created_at DESC`,
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

        const body = await request.json();

        const insertRes = await query(
            `INSERT INTO ${SCHEMA}.task_time_logs (task_id, user_id, hours, note, log_date)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [taskId, user.id, body.hours, body.note ?? null, body.log_date ?? new Date().toISOString().slice(0, 10)],
        );

        const profileRes = await query<{ full_name: string; avatar_url: string }>(
            `SELECT full_name, avatar_url FROM ${SCHEMA}.profiles WHERE id = $1 LIMIT 1`,
            [user.id],
        );
        const profile = profileRes.rows[0];

        return NextResponse.json({
            ...insertRes.rows[0],
            user_full_name: profile?.full_name ?? null,
            user_avatar_url: profile?.avatar_url ?? null,
        });
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
