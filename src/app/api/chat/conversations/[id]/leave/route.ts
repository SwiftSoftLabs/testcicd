/**
 * POST /api/chat/conversations/[id]/leave
 */
import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { requireConversationMember } from '@/lib/chat/chatAccess';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id: conversationId } = await params;
        await requireConversationMember(conversationId, user.id);

        const result = await query(
            `UPDATE ${SCHEMA}.conversation_members
             SET left_at = NOW()
             WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
             RETURNING conversation_id`,
            [conversationId, user.id],
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Not a member of this conversation' }, { status: 404 });
        }

        return NextResponse.json({ ok: true });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
