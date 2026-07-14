import { NextResponse } from 'next/server';
import { createClient } from '@insforge/sdk';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { z } from 'zod';

const BUCKET = 'app_onework-avatars';
const MAX_BYTES = 2 * 1024 * 1024;

// SVG excluded: InsForge Storage serves all files as binary/octet-stream,
// which browsers refuse to render in <img> tags for SVG (security policy).
const ALLOWED_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
]);

const EXT_BY_MIME: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
};

const uploadSchema = z.object({
    file: z.instanceof(File).refine((f) => ALLOWED_TYPES.has(f.type), {
        message: 'Avatar must be a JPEG, PNG, GIF, WebP, or SVG image.',
    }),
});

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);

        const formData = await request.formData();
        const parsed = uploadSchema.safeParse({ file: formData.get('file') });
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid file' }, { status: 400 });
        }
        const { file } = parsed.data;

        if (file.size > MAX_BYTES) {
            return NextResponse.json({ error: 'Avatar must be 2 MB or smaller.' }, { status: 413 });
        }

        const ext = EXT_BY_MIME[file.type] ?? 'png';
        const path = `${user.id}-${Date.now()}.${ext}`;

        const insforge = createClient({
            baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
            anonKey: process.env.INSFORGE_API_KEY!,
        });

        const { error: uploadError } = await insforge.storage.from(BUCKET).upload(path, file);
        if (uploadError) {
            return NextResponse.json({ error: (uploadError as Error).message ?? 'Upload failed' }, { status: 500 });
        }

        const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL!.replace(/\/$/, '');
        const url = `${baseUrl}/api/storage/buckets/${BUCKET}/objects/${path}`;

        return NextResponse.json({ url });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
