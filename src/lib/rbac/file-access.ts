import { query, SCHEMA } from '@/lib/db';
import { requireWorkspaceMember, WorkspaceAccessError, type WorkspaceMembership } from './workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getFileWorkspaceId(fileId: string): Promise<string | null> {
    if (!UUID_RE.test(fileId)) {
        throw new WorkspaceAccessError('Invalid file id.');
    }
    const res = await query<{ workspace_id: string }>(
        `SELECT workspace_id FROM ${SCHEMA}.workspace_files WHERE id = $1 LIMIT 1`,
        [fileId],
    );
    return res.rows[0]?.workspace_id ?? null;
}

export async function getFolderWorkspaceId(folderId: string): Promise<string | null> {
    if (!UUID_RE.test(folderId)) {
        throw new WorkspaceAccessError('Invalid folder id.');
    }
    const res = await query<{ workspace_id: string }>(
        `SELECT workspace_id FROM ${SCHEMA}.workspace_folders WHERE id = $1 LIMIT 1`,
        [folderId],
    );
    return res.rows[0]?.workspace_id ?? null;
}

export async function requireWorkspaceFilesAccess(
    workspaceId: string,
    userId: string,
): Promise<WorkspaceMembership> {
    if (!UUID_RE.test(workspaceId)) {
        throw new WorkspaceAccessError('Invalid workspace id.');
    }
    return requireWorkspaceMember(workspaceId, userId);
}

export async function canDeleteWorkspaceFile(
    userId: string,
    file: { uploaded_by: string; workspace_id: string },
    membership: WorkspaceMembership,
): Promise<boolean> {
    if (file.uploaded_by === userId) return true;
    if (membership.isOwner) return true;
    const ownerRes = await query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM ${SCHEMA}.workspaces WHERE id = $1 AND owner_id = $2) AS exists`,
        [file.workspace_id, userId],
    );
    return Boolean(ownerRes.rows[0]?.exists);
}

export async function canDeleteWorkspaceFolder(
    userId: string,
    folder: { created_by: string; workspace_id: string },
    membership: WorkspaceMembership,
): Promise<boolean> {
    if (folder.created_by === userId) return true;
    if (membership.isOwner) return true;
    const ownerRes = await query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM ${SCHEMA}.workspaces WHERE id = $1 AND owner_id = $2) AS exists`,
        [folder.workspace_id, userId],
    );
    return Boolean(ownerRes.rows[0]?.exists);
}
