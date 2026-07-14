import { NextResponse } from 'next/server';
import { assertChannelWritable } from '@/lib/billing/quota-locks';
import { query, SCHEMA } from '@/lib/db';
import { requireMessageAccess } from '@/lib/chat/chatAccess';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;
        const access = await requireMessageAccess(id, user.id);
        await assertChannelWritable(access.conversationId);

        let body: { emoji: string };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const { emoji } = body;
        if (!emoji) {
            return NextResponse.json({ error: 'emoji is required' }, { status: 400 });
        }

        const msgResult = await query(
            `SELECT metadata FROM ${SCHEMA}.messages WHERE id = $1 AND deleted_at IS NULL`,
            [id],
        );

        if (msgResult.rows.length === 0) {
            return NextResponse.json({ error: 'Message not found' }, { status: 404 });
        }

        const metadata: Record<string, unknown> = (msgResult.rows[0].metadata as Record<string, unknown>) || {};
        const reactions: Record<string, string[]> = (metadata.reactions as Record<string, string[]>) || {};
        const userList = reactions[emoji] || [];

        if (userList.includes(user.id)) {
            reactions[emoji] = userList.filter((u: string) => u !== user.id);
        } else {
            reactions[emoji] = [...userList, user.id];
        }

        metadata.reactions = reactions;

        const updateResult = await query(
            `UPDATE ${SCHEMA}.messages
             SET metadata = $1
             WHERE id = $2
             RETURNING id, metadata`,
            [metadata, id],
        );

        return NextResponse.json({ data: updateResult.rows[0] });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
