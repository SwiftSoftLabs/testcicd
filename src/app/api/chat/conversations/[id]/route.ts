/**
 * POST /api/chat/conversations/[id]/read | /leave (legacy combined handler)
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

        const { pathname } = new URL(request.url);
        const isLeave = pathname.endsWith('/leave');
        const isRead = pathname.endsWith('/read');

        if (isRead) {
            await query(
                `UPDATE ${SCHEMA}.conversation_members
                 SET last_read_at = NOW()
                 WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
                [conversationId, user.id],
            );
            return NextResponse.json({ ok: true });
        }

        if (isLeave) {
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
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
