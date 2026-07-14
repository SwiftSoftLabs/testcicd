import { NextResponse } from 'next/server';
import { query, SCHEMA, buildInsert } from '@/lib/db';
import { requireWorkspaceFilesAccess } from '@/lib/rbac/file-access';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);

        const body = await request.json() as { workspace_id?: string; parent_id?: string | null; name?: string };
        const { workspace_id, parent_id = null, name } = body;

        if (!workspace_id) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
        if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

        await requireWorkspaceFilesAccess(workspace_id, user.id);

        const { sql, params } = buildInsert(`${SCHEMA}.workspace_folders`, {
            workspace_id,
            parent_id: parent_id ?? null,
            name: name.trim(),
            created_by: user.id,
        });
        const result = await query(sql, params);
        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
