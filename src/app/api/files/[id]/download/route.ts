import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { createClient } from '@insforge/sdk';
import { requireWorkspaceFilesAccess } from '@/lib/rbac/file-access';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';

const BUCKET = 'workspace-files';

const insforge = createClient({
    baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
    anonKey: process.env.INSFORGE_API_KEY!,
});

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;

        const fileRes = await query<{ storage_path: string; file_name: string; file_type: string; workspace_id: string }>(
            `SELECT storage_path, file_name, file_type, workspace_id FROM ${SCHEMA}.workspace_files WHERE id = $1`,
            [id],
        );
        const file = fileRes.rows[0];
        if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        await requireWorkspaceFilesAccess(file.workspace_id, user.id);

        const { data: blob, error } = await insforge.storage.from(BUCKET).download(file.storage_path);
        if (error || !blob) {
            return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });
        }

        const asciiName = file.file_name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
        const encodedName = encodeURIComponent(file.file_name);
        const inline = new URL(request.url).searchParams.get('inline') === '1';
        const disposition = inline ? 'inline' : 'attachment';
        return new Response(blob, {
            headers: {
                'Content-Type': file.file_type || 'application/octet-stream',
                'Content-Disposition': `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
            },
        });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
