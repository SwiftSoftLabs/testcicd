/**
 * GET  /api/chat/messages?conversationId=&cursor=&limit=
 * POST /api/chat/messages
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertChannelWritable } from '@/lib/billing/quota-locks';
import { query, SCHEMA } from '@/lib/db';
import { requireConversationAccess } from '@/lib/chat/chatAccess';
import {
    bumpThreadReplyStats,
    CHANNEL_TIMELINE_FILTER,
    MESSAGE_SELECT_FIELDS,
    REPLY_USERS_LATERAL,
    resolveThreadRootMessageId,
} from '@/lib/chat/message-threads';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';
import { canReceiveChatNotification } from '@/lib/notification-preferences';
import { enrichSlackMessagesForRead } from '@/lib/chat/enrichSlackMessages';
import { pushMessageIfLinked } from '@/lib/plugins/chat/sync-engine';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const postBodySchema = z.object({
    conversation_id: z.string().uuid(),
    content: z.string().min(1),
    type: z.string().optional(),
    reply_to_message_id: z.string().uuid().optional(),
    thread_root_message_id: z.string().uuid().optional(),
    also_send_to_channel: z.boolean().optional(),
    client_message_id: z.string().optional(),
    attachments: z.array(z.unknown()).optional(),
    sender_id: z.string().uuid().optional(),
});

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const conversationId = searchParams.get('conversationId');
        const cursor = searchParams.get('cursor');
        const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

        if (!conversationId || !UUID_RE.test(conversationId)) {
            return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
        }

        await requireConversationAccess(conversationId, user.id);

        const params: unknown[] = [conversationId];
        let cursorClause = '';
        if (cursor) {
            params.push(cursor);
            cursorClause = ` AND m.created_at < (SELECT created_at FROM ${SCHEMA}.messages WHERE id = $${params.length})`;
        }
        params.push(limit);

        const sql = `
            SELECT * FROM (
                SELECT
                    ${MESSAGE_SELECT_FIELDS},
                    ${REPLY_USERS_LATERAL}
                FROM ${SCHEMA}.messages m
                LEFT JOIN ${SCHEMA}.profiles p ON p.id = m.sender_id
                WHERE m.conversation_id = $1
                  AND m.deleted_at IS NULL
                  ${CHANNEL_TIMELINE_FILTER}
                  ${cursorClause}
                ORDER BY m.created_at DESC
                LIMIT $${params.length}
            ) recent
            ORDER BY recent.created_at ASC
        `;

        const result = await query<{
            content: string;
            metadata: unknown;
            [key: string]: unknown;
        }>(sql, params);
        const data = await enrichSlackMessagesForRead(conversationId, result.rows);
        return NextResponse.json({ data });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);

        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const parsed = postBodySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
                { status: 400 },
            );
        }

        const {
            conversation_id,
            sender_id,
            content,
            type,
            reply_to_message_id,
            thread_root_message_id,
            also_send_to_channel,
            client_message_id,
            attachments,
        } = parsed.data;

        if (sender_id && sender_id !== user.id) {
            return NextResponse.json({ error: 'sender_id must match the authenticated user' }, { status: 403 });
        }

        await requireConversationAccess(conversation_id, user.id);
        await assertChannelWritable(conversation_id);

        const senderId = user.id;
        let resolvedThreadRootId: string | null = null;
        const alsoSentToChannel = Boolean(also_send_to_channel);

        if (thread_root_message_id) {
            const resolved = await resolveThreadRootMessageId(thread_root_message_id, conversation_id);
            if ('error' in resolved) {
                return NextResponse.json({ error: resolved.error }, { status: resolved.status });
            }
            resolvedThreadRootId = resolved.rootId;
        } else if (reply_to_message_id) {
            const resolved = await resolveThreadRootMessageId(reply_to_message_id, conversation_id);
            if ('error' in resolved) {
                return NextResponse.json({ error: resolved.error }, { status: resolved.status });
            }
            resolvedThreadRootId = resolved.rootId;
        }

        const metadata = attachments && attachments.length > 0
            ? JSON.stringify({ attachments })
            : null;

        const result = await query<{
            id: string;
            conversation_id: string;
            sender_id: string;
            content: string;
            type: string;
            created_at: string;
            thread_root_message_id: string | null;
            also_sent_to_channel: boolean;
            metadata: unknown;
        }>(
            `INSERT INTO ${SCHEMA}.messages
                (conversation_id, sender_id, content, type, reply_to_message_id,
                 thread_root_message_id, also_sent_to_channel, client_message_id, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
             RETURNING id, conversation_id, sender_id, content, type, created_at,
                       thread_root_message_id, also_sent_to_channel, metadata`,
            [
                conversation_id,
                senderId,
                content || '',
                type || 'text',
                reply_to_message_id || resolvedThreadRootId || null,
                resolvedThreadRootId,
                alsoSentToChannel,
                client_message_id || null,
                metadata,
            ],
        );

        const message = result.rows[0];
        if (!message) throw new Error('Failed to insert message');

        if (resolvedThreadRootId) {
            await bumpThreadReplyStats(resolvedThreadRootId, message.created_at);
        }

        const profileResult = await query(
            `SELECT full_name, avatar_url, email FROM ${SCHEMA}.profiles WHERE id = $1`,
            [senderId],
        );
        const profile = profileResult.rows[0];

        const membersResult = await query<{ user_id: string }>(
            `SELECT user_id
             FROM ${SCHEMA}.conversation_members
             WHERE conversation_id = $1
               AND left_at IS NULL
               AND user_id != $2`,
            [conversation_id, senderId],
        );

        const senderName = (profile?.full_name as string | undefined) || 'Someone';
        for (const member of membersResult.rows) {
            if (!member.user_id) continue;
            const canNotify = await canReceiveChatNotification(member.user_id);
            if (!canNotify) continue;

            await query(
                `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type, ref_id)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    member.user_id,
                    resolvedThreadRootId
                        ? `New thread reply from ${senderName}`
                        : `New message from ${senderName}`,
                    String(content),
                    'mention',
                    conversation_id,
                ],
            );
        }

        try {
            await pushMessageIfLinked(conversation_id, message.id, String(content));
        } catch {
            /* plugin push is best-effort */
        }

        let replyCount: number | undefined;
        let lastReplyAt: string | undefined;
        if (resolvedThreadRootId) {
            const stats = await query<{ reply_count: number; last_reply_at: string | null }>(
                `SELECT reply_count, last_reply_at FROM ${SCHEMA}.messages WHERE id = $1`,
                [resolvedThreadRootId],
            );
            replyCount = stats.rows[0]?.reply_count;
            lastReplyAt = stats.rows[0]?.last_reply_at ?? undefined;
        }

        return NextResponse.json({
            data: {
                ...message,
                sender_name: profile?.full_name || null,
                sender_avatar: profile?.avatar_url || null,
                sender_email: profile?.email || null,
                thread_root_reply_count: replyCount,
                thread_root_last_reply_at: lastReplyAt,
            },
        }, { status: 201 });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
