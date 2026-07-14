import { query, buildInsert, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import { toAccessResponse } from '@/lib/rbac/http';
import {
    memberCan,
    requireSessionUser,
    requireWorkspaceMember,
    WorkspaceAccessError,
} from '@/lib/rbac/workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspaceId');

        if (!workspaceId || !UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
        }

        await requireWorkspaceMember(workspaceId, user.id);

        const result = await query(
            `SELECT * FROM ${SCHEMA}.sprints WHERE workspace_id = $1 ORDER BY created_at DESC`,
            [workspaceId],
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

const sprintBodySchema = z.object({
    name: z.string().min(1, 'Name is required'),
    workspace_id: z.string().uuid('Invalid workspace_id'),
    project_id: z.string().uuid().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    duration_days: z.number().int().positive().optional(),
    status: z.enum(['planning', 'active', 'completed']).optional(),
});

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const raw = await request.json();
        const parsed = sprintBodySchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join('; ') }, { status: 400 });
        }

        const membership = await requireWorkspaceMember(parsed.data.workspace_id, user.id);
        if (!memberCan(membership, 'manage_workflows')) {
            return NextResponse.json({ error: 'You do not have permission to manage sprints.' }, { status: 403 });
        }
        await assertProjectWritable(parsed.data.project_id ?? null);

        const { sql, params } = buildInsert(`${SCHEMA}.sprints`, parsed.data);
        const result = await query(sql, params);
        return NextResponse.json(result.rows[0]);
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
