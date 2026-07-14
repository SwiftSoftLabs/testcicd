/**
 * GET    /api/chat/conversations/[id]/members         — list members
 * POST   /api/chat/conversations/[id]/members         — add member { user_id }
 * DELETE /api/chat/conversations/[id]/members         — remove member { user_id }
 */
import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { requireConversationAccess, requireCreateChannel } from '@/lib/chat/chatAccess';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';
import { assertChannelWritable } from '@/lib/billing/quota-locks';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id: conversationId } = await params;
        await requireConversationAccess(conversationId, user.id);

        const result = await query<{
            user_id: string;
            role: string;
            full_name: string | null;
            avatar_url: string | null;
            email: string | null;
            joined_at: string;
        }>(
            `SELECT cm.user_id, cm.role, cm.joined_at,
                    p.full_name, p.avatar_url, p.email
             FROM ${SCHEMA}.conversation_members cm
             LEFT JOIN ${SCHEMA}.profiles p ON p.id = cm.user_id
             WHERE cm.conversation_id = $1 AND cm.left_at IS NULL
             ORDER BY cm.joined_at ASC`,
            [conversationId],
        );

        return NextResponse.json({ data: result.rows });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id: conversationId } = await params;

        let body: Record<string, unknown>;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const { user_id } = body as { user_id?: string };
        if (!user_id || !UUID_RE.test(user_id)) {
            return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
        }

        const access = await requireConversationAccess(conversationId, user.id);
        if (access.type === 'dm') {
            return NextResponse.json({ error: 'Cannot add members to a DM' }, { status: 400 });
        }

        await assertChannelWritable(conversationId);
        await requireCreateChannel(access.workspaceId, user.id);

        // Verify the target user is a workspace member
        const wsCheck = await query<{ user_id: string }>(
            `SELECT user_id FROM ${SCHEMA}.workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
            [access.workspaceId, user_id],
        );
        if (!wsCheck.rows.length) {
            return NextResponse.json({ error: 'User is not a workspace member' }, { status: 400 });
        }

        await query(
            `INSERT INTO ${SCHEMA}.conversation_members (conversation_id, user_id, role)
             VALUES ($1, $2, 'member')
             ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL`,
            [conversationId, user_id],
        );

        return NextResponse.json({ ok: true }, { status: 201 });
    } catch (error: unknown) {
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
        const { id: conversationId } = await params;

        let body: Record<string, unknown>;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const { user_id } = body as { user_id?: string };
        if (!user_id || !UUID_RE.test(user_id)) {
            return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
        }

        const access = await requireConversationAccess(conversationId, user.id);
        if (access.type === 'dm') {
            return NextResponse.json({ error: 'Cannot remove members from a DM' }, { status: 400 });
        }

        await assertChannelWritable(conversationId);
        await requireCreateChannel(access.workspaceId, user.id);

        // Prevent removing the channel creator
        const creatorCheck = await query<{ created_by: string }>(
            `SELECT created_by FROM ${SCHEMA}.conversations WHERE id = $1 LIMIT 1`,
            [conversationId],
        );
        if (creatorCheck.rows[0]?.created_by === user_id) {
            return NextResponse.json({ error: 'Cannot remove the channel creator' }, { status: 400 });
        }

        await query(
            `UPDATE ${SCHEMA}.conversation_members
             SET left_at = NOW()
             WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
            [conversationId, user_id],
        );

        return NextResponse.json({ ok: true });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
