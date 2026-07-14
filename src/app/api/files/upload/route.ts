import { NextResponse } from 'next/server';
import { query, SCHEMA, buildInsert } from '@/lib/db';
import { createClient } from '@insforge/sdk';
import { canReceiveFileNotification } from '@/lib/notification-preferences';
import { requireWorkspaceFilesAccess } from '@/lib/rbac/file-access';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { checkWorkspaceStorage } from '@/lib/files/storageQuota';

const BUCKET = 'workspace-files';

const ALLOWED_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'text/plain',
    'text/csv',
    'text/markdown',
    'text/x-markdown',
    'application/json',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const insforge = createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    anonKey: process.env.INSFORGE_API_KEY!,
});

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const workspaceId = formData.get('workspace_id') as string | null;
        const folderId = formData.get('folder_id') as string | null;

        if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });

        await requireWorkspaceFilesAccess(workspaceId, user.id);

        if (!ALLOWED_TYPES.has(file.type)) {
            return NextResponse.json(
                { error: 'File type not allowed. Accepted: images, text, markdown, JSON, PDF, Word documents.' },
                { status: 415 },
            );
        }

        const storageCheck = await checkWorkspaceStorage(workspaceId, file.size);
        if (!storageCheck.allowed) {
            return NextResponse.json(
                { error: storageCheck.error, code: storageCheck.code },
                { status: 413 },
            );
        }

        const segment = folderId ?? 'root';
        const path = `${workspaceId}/${segment}/${Date.now()}-${file.name}`;

        const { data: uploadData, error: storageError } = await insforge.storage.from(BUCKET).upload(path, file);
        if (storageError) {
            return NextResponse.json({ error: storageError.message }, { status: 500 });
        }

        const storagePath = uploadData!.key;

        try {
            const { sql, params } = buildInsert(`${SCHEMA}.workspace_files`, {
                workspace_id: workspaceId,
                folder_id: folderId ?? null,
                file_name: file.name,
                file_size: file.size,
                file_type: file.type,
                storage_path: storagePath,
                uploaded_by: user.id,
            });
            const insertRes = await query(sql, params);
            const inserted = insertRes.rows[0];

            if (!inserted) {
                await insforge.storage.from(BUCKET).remove(storagePath);
                return NextResponse.json({ error: 'File saved to storage but database record was not created.' }, { status: 500 });
            }

            const membersRes = await query<{ user_id: string }>(
                `SELECT user_id FROM ${SCHEMA}.workspace_members WHERE workspace_id = $1`,
                [workspaceId],
            );
            for (const member of membersRes.rows) {
                if (member.user_id === user.id) continue;
                const canNotify = await canReceiveFileNotification(member.user_id);
                if (!canNotify) continue;
                await query(
                    `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [member.user_id, 'New file uploaded', file.name, 'system', inserted.id],
                );
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
