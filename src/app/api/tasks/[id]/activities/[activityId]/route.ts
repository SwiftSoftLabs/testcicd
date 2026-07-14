import { query, SCHEMA } from '@/lib/db';
import { assertTaskWritable } from '@/lib/billing/quota-locks';
import { NextResponse } from 'next/server';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';
import { createClient } from '@insforge/sdk';
import { z } from 'zod';

const patchActivitySchema = z.object({
    content: z.string().min(1, 'Content is required').trim(),
});

const COMMENT_IMAGES_BUCKET = 'comment-images';

function extractStoragePath(url: string): string | null {
    try {
        const parsed = new URL(url);
        const marker = '/objects/';
        const idx = parsed.pathname.indexOf(marker);
        if (idx === -1) return null;
        return decodeURIComponent(parsed.pathname.slice(idx + marker.length));
    } catch { return null; }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string; activityId: string }> },
) {
    try {
        const [user, { id: taskId, activityId }, raw] = await Promise.all([
            requireSessionUser(request),
            params,
            request.json().catch(() => ({})),
        ]);

        const parsed = patchActivitySchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join('; ') }, { status: 400 });
        }
        const { content } = parsed.data;
        await assertTaskWritable(taskId);

        const result = await query(
            `UPDATE ${SCHEMA}.task_activities
             SET content = $1
             WHERE id = $2
               AND task_id = $3
               AND user_id = $4
             RETURNING *`,
            [content, activityId, taskId, user.id],
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Activity not found or forbidden' }, { status: 404 });
        }
        return NextResponse.json(result.rows[0]);
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; activityId: string }> },
) {
    try {
        const [user, { id: taskId, activityId }] = await Promise.all([
            requireSessionUser(request),
            params,
        ]);

        const fetchResult = await query<{ type: string; content: string }>(
            `SELECT type, content FROM ${SCHEMA}.task_activities
             WHERE id = $1 AND task_id = $2 AND user_id = $3`,
            [activityId, taskId, user.id],
        );

        if (fetchResult.rows.length === 0) {
            return NextResponse.json({ error: 'Activity not found or forbidden' }, { status: 404 });
        }

        const activity = fetchResult.rows[0];
        await assertTaskWritable(taskId);

        await query(
            `DELETE FROM ${SCHEMA}.task_activities
             WHERE id = $1 AND task_id = $2 AND user_id = $3`,
            [activityId, taskId, user.id],
        );

        if (activity.type === 'comment_image') {
            try {
                let imageUrl = activity.content;
                try { imageUrl = (JSON.parse(activity.content) as { imageUrl?: string }).imageUrl ?? activity.content; } catch { /* plain URL fallback */ }
                const storagePath = extractStoragePath(imageUrl);
                if (storagePath) {
                    const insforge = createClient({
                        baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
                        anonKey: process.env.INSFORGE_API_KEY!,
                    });
                    await insforge.storage.from(COMMENT_IMAGES_BUCKET).remove(storagePath);
                }
            } catch {
                console.error('Failed to remove comment image from storage');
            }
        }

        return new NextResponse(null, { status: 204 });
    } catch (e: unknown) {
        const access = toAccessResponse(e);
        if (access) return access;
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
