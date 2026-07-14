import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { WorkspaceFile, WorkspaceFolder } from '@/types/files';
import {
    requireSessionUser,
    requireWorkspaceMember,
    WorkspaceAccessError,
} from '@/lib/rbac/workspace-access';
import { getWorkspaceStorageLimitBytes, getWorkspaceStorageUsed } from '@/lib/files/storageQuota';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);

        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspace_id');
        const folderId = searchParams.get('folder_id') ?? null;

        if (!workspaceId || !UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
        }

        await requireWorkspaceMember(workspaceId, user.id);

        const treeMode = searchParams.get('tree') === 'true';
        if (treeMode) {
            const allFoldersRes = await query<WorkspaceFolder>(
                `SELECT id, workspace_id, parent_id, name, created_by, created_at, updated_at
                 FROM ${SCHEMA}.workspace_folders
                 WHERE workspace_id = $1
                 ORDER BY name ASC`,
                [workspaceId],
            );
            return NextResponse.json({ folders: allFoldersRes.rows });
        }

        const [foldersRes, filesRes, usageRes, storageLimit] = await Promise.all([
        query<WorkspaceFolder>(
            `SELECT id, workspace_id, parent_id, name, created_by, created_at, updated_at
             FROM ${SCHEMA}.workspace_folders
             WHERE workspace_id = $1
               AND (parent_id = $2 OR ($2::uuid IS NULL AND parent_id IS NULL))
             ORDER BY name ASC`,
            [workspaceId, folderId],
        ),
        query<WorkspaceFile>(
            `SELECT id, workspace_id, folder_id, file_name, file_size, file_type, storage_path, uploaded_by, created_at
             FROM ${SCHEMA}.workspace_files
             WHERE workspace_id = $1
               AND (folder_id = $2 OR ($2::uuid IS NULL AND folder_id IS NULL))
             ORDER BY created_at DESC`,
            [workspaceId, folderId],
        ),
        query<{ total: string }>(
            `SELECT COALESCE(SUM(file_size), 0)::text AS total
             FROM ${SCHEMA}.workspace_files
             WHERE workspace_id = $1`,
            [workspaceId],
        ),
        getWorkspaceStorageLimitBytes(workspaceId),
    ]);

        return NextResponse.json({
            folders: foldersRes.rows,
            files: filesRes.rows,
            storage_used: parseInt(usageRes.rows[0]?.total ?? '0', 10),
            storage_limit: storageLimit,
        });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        const msg = e instanceof Error ? e.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
