import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { createClient } from '@insforge/sdk';
import {
    canDeleteWorkspaceFolder,
    requireWorkspaceFilesAccess,
} from '@/lib/rbac/file-access';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';

const BUCKET = 'workspace-files';

const insforge = createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    anonKey: process.env.INSFORGE_API_KEY!,
});

async function deleteFolderRecursive(folderId: string) {
    const childFolders = await query<{ id: string }>(
        `SELECT id FROM ${SCHEMA}.workspace_folders WHERE parent_id = $1`,
        [folderId],
    );
    for (const child of childFolders.rows) {
        await deleteFolderRecursive(child.id);
    }

    const filesRes = await query<{ storage_path: string }>(
        `SELECT storage_path FROM ${SCHEMA}.workspace_files WHERE folder_id = $1`,
        [folderId],
    );
    for (const f of filesRes.rows) {
        await insforge.storage.from(BUCKET).remove(f.storage_path);
    }
    await query(`DELETE FROM ${SCHEMA}.workspace_files WHERE folder_id = $1`, [folderId]);
    await query(`DELETE FROM ${SCHEMA}.workspace_folders WHERE id = $1`, [folderId]);
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;

        const folderRes = await query<{ created_by: string; workspace_id: string }>(
            `SELECT created_by, workspace_id FROM ${SCHEMA}.workspace_folders WHERE id = $1`,
            [id],
        );
        const folder = folderRes.rows[0];
        if (!folder) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const membership = await requireWorkspaceFilesAccess(folder.workspace_id, user.id);
        const allowed = await canDeleteWorkspaceFolder(user.id, folder, membership);
        if (!allowed) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        await deleteFolderRecursive(id);

        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
