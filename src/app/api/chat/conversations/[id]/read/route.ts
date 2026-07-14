/**
 * POST /api/chat/conversations/[id]/read
 */
import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { requireConversationAccess } from '@/lib/chat/chatAccess';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id: conversationId } = await params;
        await requireConversationAccess(conversationId, user.id);

        await query(
            `UPDATE ${SCHEMA}.conversation_members
             SET last_read_at = NOW()
             WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
            [conversationId, user.id],
        );
        return NextResponse.json({ ok: true });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
