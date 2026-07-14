/**
 * GET /api/chat/messages/[id]/replies?cursor=&limit=
 */
import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { requireConversationAccess } from '@/lib/chat/chatAccess';
import { messageSelectFields } from '@/lib/chat/message-threads';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';
import { enrichSlackMessagesForRead } from '@/lib/chat/enrichSlackMessages';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
    try {
        const user = await requireSessionUser(request);
        const { id: rootId } = await context.params;
        const { searchParams } = new URL(request.url);
        const cursor = searchParams.get('cursor');
        const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

        if (!UUID_RE.test(rootId)) {
            return NextResponse.json({ error: 'Invalid message id' }, { status: 400 });
        }

        const parentResult = await query<{
            id: string;
            conversation_id: string;
            thread_root_message_id: string | null;
            deleted_at: string | null;
        }>(
            `SELECT id, conversation_id, thread_root_message_id, deleted_at
             FROM ${SCHEMA}.messages
             WHERE id = $1`,
            [rootId],
        );
        const parent = parentResult.rows[0];
        if (!parent || parent.deleted_at) {
            return NextResponse.json({ error: 'Message not found' }, { status: 404 });
        }
        if (parent.thread_root_message_id) {
            return NextResponse.json({ error: 'Cannot load replies for a thread reply' }, { status: 400 });
        }

        await requireConversationAccess(parent.conversation_id, user.id);

        const parentMessageSql = `
            SELECT ${messageSelectFields('m')}
            FROM ${SCHEMA}.messages m
            LEFT JOIN ${SCHEMA}.profiles p ON p.id = m.sender_id
            WHERE m.id = $1
        `;
        const parentRow = await query<{ content: string; metadata: unknown; [key: string]: unknown }>(
            parentMessageSql,
            [rootId],
        );
        const enrichedParent = await enrichSlackMessagesForRead(
            parent.conversation_id,
            parentRow.rows,
        );

        const replyParams: unknown[] = [rootId];
        let cursorClause = '';
        if (cursor) {
            replyParams.push(cursor);
            cursorClause = ` AND m.created_at > (SELECT created_at FROM ${SCHEMA}.messages WHERE id = $${replyParams.length})`;
        }
        replyParams.push(limit + 1);

        const repliesSql = `
            SELECT ${messageSelectFields('m')}
            FROM ${SCHEMA}.messages m
            LEFT JOIN ${SCHEMA}.profiles p ON p.id = m.sender_id
            WHERE m.thread_root_message_id = $1
              AND m.deleted_at IS NULL
              ${cursorClause}
            ORDER BY m.created_at ASC
            LIMIT $${replyParams.length}
        `;

        const repliesResult = await query<{ content: string; metadata: unknown; [key: string]: unknown }>(
            repliesSql,
            replyParams,
        );
        const rows = repliesResult.rows;
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const enrichedReplies = await enrichSlackMessagesForRead(parent.conversation_id, pageRows);

        return NextResponse.json({
            data: {
                parent: enrichedParent[0] ?? null,
                replies: enrichedReplies,
                hasMore,
                nextCursor: hasMore ? pageRows[pageRows.length - 1]?.id : null,
            },
        });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
