import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { createClient } from '@insforge/sdk';
import {
    canDeleteWorkspaceFile,
    getFileWorkspaceId,
    requireWorkspaceFilesAccess,
} from '@/lib/rbac/file-access';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';

const BUCKET = 'workspace-files';

const insforge = createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    anonKey: process.env.INSFORGE_API_KEY!,
});

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;
        const body = await request.json() as { folder_id?: string | null };

        const workspaceId = await getFileWorkspaceId(id);
        if (!workspaceId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        await requireWorkspaceFilesAccess(workspaceId, user.id);

        const targetFolderId = body.folder_id ?? null;
        const updated = await query(
            `UPDATE ${SCHEMA}.workspace_files SET folder_id = $1 WHERE id = $2 RETURNING *`,
            [targetFolderId, id],
        );

        return NextResponse.json(updated.rows[0]);
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
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

        const fileRes = await query<{ storage_path: string; uploaded_by: string; workspace_id: string }>(
            `SELECT storage_path, uploaded_by, workspace_id FROM ${SCHEMA}.workspace_files WHERE id = $1`,
            [id],
        );
        const file = fileRes.rows[0];
        if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const membership = await requireWorkspaceFilesAccess(file.workspace_id, user.id);
        const allowed = await canDeleteWorkspaceFile(user.id, file, membership);
        if (!allowed) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        await insforge.storage.from(BUCKET).remove(file.storage_path);
        await query(`DELETE FROM ${SCHEMA}.workspace_files WHERE id = $1`, [id]);

        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
