import { query, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const result = await query(
            `SELECT * FROM ${SCHEMA}.notifications WHERE user_id = $1 ORDER BY created_at DESC`,
            [user.id],
        );
        return NextResponse.json(result.rows);
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (id) {
            await query(
                `UPDATE ${SCHEMA}.notifications SET is_read = true WHERE user_id = $1 AND id = $2`,
                [user.id, id],
            );
        } else {
            await query(
                `UPDATE ${SCHEMA}.notifications SET is_read = true WHERE user_id = $1`,
                [user.id],
            );
        }
        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
