/**
 * PATCH  /api/chat/messages/[id]
 * DELETE /api/chat/messages/[id]
 */
import { NextResponse } from 'next/server';
import { assertChannelWritable } from '@/lib/billing/quota-locks';
import { query, SCHEMA } from '@/lib/db';
import {
    requireConversationAccess,
    requireMessageAccess,
    requireModerateContent,
} from '@/lib/chat/chatAccess';
import { assertMessageEditableInOneWork, PluginSourcedMessageError } from '@/lib/plugins/chat/message-guard';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;

        let body: { content?: string; metadata?: { reactions?: Record<string, string[]> } };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const { content, metadata } = body;
        if (content === undefined && metadata === undefined) {
            return NextResponse.json({ error: 'content or metadata is required' }, { status: 400 });
        }

        const access = await requireMessageAccess(id, user.id);
        await assertChannelWritable(access.conversationId);

        if (content !== undefined) {
            await assertMessageEditableInOneWork(id);
        }

        let result;
        if (content !== undefined && metadata !== undefined) {
            result = await query(
                `UPDATE ${SCHEMA}.messages
                 SET content = $1, metadata = $2, updated_at = NOW()
                 WHERE id = $3 AND sender_id = $4 AND deleted_at IS NULL
                 RETURNING id, content, metadata, updated_at`,
                [content.trim(), metadata, id, user.id],
            );
        } else if (content !== undefined) {
            result = await query(
                `UPDATE ${SCHEMA}.messages
                 SET content = $1, updated_at = NOW()
                 WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL
                 RETURNING id, content, metadata, updated_at`,
                [content.trim(), id, user.id],
            );
        } else if (metadata !== undefined) {
            await requireConversationAccess(access.conversationId, user.id);
            result = await query(
                `UPDATE ${SCHEMA}.messages
                 SET metadata = $1
                 WHERE id = $2 AND deleted_at IS NULL
                 RETURNING id, content, metadata, updated_at`,
                [metadata, id],
            );
        }

        if (!result || result.rows.length === 0) {
            return NextResponse.json(
                { error: 'Message not found or you are not authorized' },
                { status: 403 },
            );
        }

        return NextResponse.json({ data: result.rows[0] });
    } catch (error: unknown) {
        if (error instanceof PluginSourcedMessageError) {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;

        const msgRow = await query<{ sender_id: string; conversation_id: string }>(
            `SELECT sender_id, conversation_id FROM ${SCHEMA}.messages WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
            [id],
        );
        const row = msgRow.rows[0];
        if (!row) {
            return NextResponse.json({ error: 'Message not found' }, { status: 404 });
        }
        await assertChannelWritable(row.conversation_id);

        await assertMessageEditableInOneWork(id);

        const isOwner = row.sender_id === user.id;
        if (!isOwner) {
            await requireModerateContent(row.conversation_id, user.id);
        } else {
            await requireConversationAccess(row.conversation_id, user.id);
        }

        const result = await query(
            `UPDATE ${SCHEMA}.messages
             SET deleted_at = NOW()
             WHERE id = $1 AND deleted_at IS NULL
             RETURNING id`,
            [id],
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Message not found' }, { status: 404 });
        }

        return NextResponse.json({ ok: true });
    } catch (error: unknown) {
        if (error instanceof PluginSourcedMessageError) {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
