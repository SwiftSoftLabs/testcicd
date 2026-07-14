import { query, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireProjectRepositoriesRead } from '@/lib/rbac/project-access';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';

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
            `SELECT c.*,
                    json_build_object('id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url) as author
             FROM ${SCHEMA}.commits c
             LEFT JOIN ${SCHEMA}.profiles p ON p.id = c.author_id
             WHERE c.project_id = $1
             ORDER BY c.created_at DESC`,
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
