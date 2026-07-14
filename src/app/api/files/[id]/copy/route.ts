import { NextResponse } from 'next/server';
import { query, SCHEMA, buildInsert } from '@/lib/db';
import { createClient } from '@insforge/sdk';
import { getFileWorkspaceId, requireWorkspaceFilesAccess } from '@/lib/rbac/file-access';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { checkWorkspaceStorage } from '@/lib/files/storageQuota';

const BUCKET = 'workspace-files';

const insforge = createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    anonKey: process.env.INSFORGE_API_KEY!,
});

function copyFileName(name: string): string {
    const dot = name.lastIndexOf('.');
    if (dot === -1) return `${name} (copy)`;
    return `${name.slice(0, dot)} (copy)${name.slice(dot)}`;
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;
        const body = await request.json() as { workspace_id: string; folder_id?: string | null };
        const { workspace_id: workspaceId } = body;
        const targetFolderId = body.folder_id ?? null;

        if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });

        const sourceWorkspaceId = await getFileWorkspaceId(id);
        if (!sourceWorkspaceId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        await requireWorkspaceFilesAccess(sourceWorkspaceId, user.id);
        await requireWorkspaceFilesAccess(workspaceId, user.id);

        const fileRes = await query<{ storage_path: string; file_name: string; file_size: number; file_type: string; workspace_id: string }>(
            `SELECT storage_path, file_name, file_size, file_type, workspace_id FROM ${SCHEMA}.workspace_files WHERE id = $1`,
            [id],
        );
        const file = fileRes.rows[0];
        if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const storageCheck = await checkWorkspaceStorage(workspaceId, file.file_size);
        if (!storageCheck.allowed) {
            return NextResponse.json(
                { error: storageCheck.error, code: storageCheck.code },
                { status: 413 },
            );
        }

        const { data: blob, error: downloadError } = await insforge.storage.from(BUCKET).download(file.storage_path);
        if (downloadError || !blob) {
            return NextResponse.json({ error: 'Failed to read source file' }, { status: 500 });
        }

        const segment = targetFolderId ?? 'root';
        const newFileName = copyFileName(file.file_name);
        const newPath = `${workspaceId}/${segment}/${Date.now()}-${newFileName}`;

        const { data: uploadData, error: storageError } = await insforge.storage.from(BUCKET).upload(newPath, blob);
        if (storageError) {
            return NextResponse.json({ error: storageError.message }, { status: 500 });
        }

        const storagePath = uploadData!.key;

        try {
            const { sql, params: insertParams } = buildInsert(`${SCHEMA}.workspace_files`, {
                workspace_id: workspaceId,
                folder_id: targetFolderId,
                file_name: newFileName,
                file_size: file.file_size,
                file_type: file.file_type,
                storage_path: storagePath,
                uploaded_by: user.id,
            });
            const insertRes = await query(sql, insertParams);
            const inserted = insertRes.rows[0];

            if (!inserted) {
                await insforge.storage.from(BUCKET).remove(storagePath);
                return NextResponse.json({ error: 'File saved to storage but database record was not created.' }, { status: 500 });
            }

            return NextResponse.json(inserted);
        } catch (e: unknown) {
            await insforge.storage.from(BUCKET).remove(storagePath);
            return NextResponse.json({ error: (e as Error).message }, { status: 500 });
        }
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
