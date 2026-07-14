import { query, buildInsert, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireProjectRepositoriesRead } from '@/lib/rbac/project-access';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const projectId = searchParams.get('projectId');

        if (!projectId) {
            return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
        }

        await requireProjectRepositoriesRead(projectId, user.id);

        const result = await query(
            `SELECT pr.*,
                    json_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url) as author
             FROM ${SCHEMA}.pull_requests pr
             LEFT JOIN ${SCHEMA}.profiles p ON p.id = pr.author_id
             WHERE pr.project_id = $1
             ORDER BY pr.created_at DESC`,
            [projectId],
        );
        return NextResponse.json(result.rows);
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : e.message === 'Project not found.' ? 404 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const body = await request.json() as { project_id?: string };
        const projectId = body.project_id;

        if (!projectId || !UUID_RE.test(projectId)) {
            return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
        }

        await requireProjectRepositoriesRead(projectId, user.id);

        const { sql, params } = buildInsert(`${SCHEMA}.pull_requests`, {
            ...body,
            author_id: user.id,
        });
        const result = await query(sql, params);
        return NextResponse.json(result.rows[0]);
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : e.message === 'Project not found.' ? 404 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
