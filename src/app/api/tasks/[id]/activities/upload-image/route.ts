import { NextResponse } from 'next/server';
import { createClient } from '@insforge/sdk';
import { assertTaskWritable } from '@/lib/billing/quota-locks';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireTaskRead } from '@/lib/rbac/task-access';
import { requireSessionUser } from '@/lib/rbac/workspace-access';
import { z } from 'zod';

const COMMENT_IMAGES_BUCKET = 'comment-images';

const uploadSchema = z.object({
    file: z.instanceof(File).refine(f => f.type.startsWith('image/'), {
        message: 'Valid image file required',
    }),
});

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const [user, { id: taskId }] = await Promise.all([
            requireSessionUser(request),
            params,
        ]);
        await requireTaskRead(taskId, user.id);
        await assertTaskWritable(taskId);

        const formData = await request.formData();
        const parsed = uploadSchema.safeParse({ file: formData.get('file') });
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid file' }, { status: 400 });
        }
        const { file } = parsed.data;

        const ext = file.type.split('/')[1] ?? 'png';
        const randomId = Math.random().toString(36).slice(2, 8);
        const path = `${taskId}-${Date.now()}-${randomId}.${ext}`;

        const insforge = createClient({
            baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
            anonKey: process.env.INSFORGE_API_KEY!,
        });

        const { error: uploadError } = await insforge.storage
            .from(COMMENT_IMAGES_BUCKET)
            .upload(path, file);

        if (uploadError) {
            console.error('[upload-image] InsForge storage error:', uploadError);
            return NextResponse.json({ error: (uploadError as Error).message ?? 'Upload failed' }, { status: 500 });
        }

        const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL!.replace(/\/$/, '');
        const url = `${baseUrl}/api/storage/buckets/${COMMENT_IMAGES_BUCKET}/objects/${path}`;

        return NextResponse.json({ url });
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
