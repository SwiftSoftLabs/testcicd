/**
 * GET  /api/chat/conversations?workspaceId=
 * POST /api/chat/conversations
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query, SCHEMA } from '@/lib/db';
import {
    assertWorkspaceMemberIds,
    requireCreateChannel,
    requireWorkspaceChatRead,
} from '@/lib/chat/chatAccess';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';
import { checkChannelLimit } from '@/lib/billing/enforce';
import { findExistingDm } from '@/lib/chat/findExistingDm';
import { dedupeConversationApiRows } from '@/lib/chat/dedupeDms';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const postBodySchema = z.object({
    workspace_id: z.string().uuid(),
    type: z.enum(['channel', 'dm']).optional().default('channel'),
    name: z.string().trim().max(200).optional(),
    description: z.string().max(2000).optional(),
    member_ids: z.array(z.string().uuid()).optional(),
});

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspaceId');

        if (!workspaceId || !UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }

        await requireWorkspaceChatRead(workspaceId, user.id);

        const result = await query(
            `SELECT
                c.id, c.workspace_id, c.type, c.name, c.description, c.created_by, c.created_at, c.quota_locked,
                CASE WHEN c.type = 'dm' THEN (
                    SELECT cm2.user_id FROM ${SCHEMA}.conversation_members cm2
                    WHERE cm2.conversation_id = c.id AND cm2.user_id != $2 AND cm2.left_at IS NULL
                    LIMIT 1
                ) END AS dm_other_id,
                CASE WHEN c.type = 'dm' THEN (
                    SELECT p.full_name FROM ${SCHEMA}.conversation_members cm2
                    JOIN ${SCHEMA}.profiles p ON p.id = cm2.user_id
                    WHERE cm2.conversation_id = c.id AND cm2.user_id != $2 AND cm2.left_at IS NULL
                    LIMIT 1
                ) END AS dm_other_name,
                CASE WHEN c.type = 'dm' THEN (
                    SELECT p.avatar_url FROM ${SCHEMA}.conversation_members cm2
                    JOIN ${SCHEMA}.profiles p ON p.id = cm2.user_id
                    WHERE cm2.conversation_id = c.id AND cm2.user_id != $2 AND cm2.left_at IS NULL
                    LIMIT 1
                ) END AS dm_other_avatar,
                CASE
                    WHEN cm.user_id IS NOT NULL THEN (
                        SELECT COUNT(*) FROM ${SCHEMA}.messages m
                        WHERE m.conversation_id = c.id
                          AND m.deleted_at IS NULL
                          AND m.sender_id != $2
                          AND m.created_at > COALESCE(cm.last_read_at, '-infinity')
                    )
                    ELSE 0
                END AS unread_count
             FROM ${SCHEMA}.conversations c
             LEFT JOIN ${SCHEMA}.conversation_members cm
                ON cm.conversation_id = c.id AND cm.user_id = $2 AND cm.left_at IS NULL
             WHERE c.workspace_id = $1
               AND (c.type != 'dm' OR cm.user_id IS NOT NULL)
               AND c.archived_at IS NULL
             ORDER BY c.type ASC, c.created_at ASC`,
            [workspaceId, user.id],
        );

        return NextResponse.json({
            data: dedupeConversationApiRows(
                result.rows as {
                    type: string;
                    id: string;
                    dm_other_id?: string | null;
                    unread_count?: number | string | null;
                }[],
            ),
        });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const sessionUser = await requireSessionUser(request);

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

        const { name, type: convType, workspace_id, member_ids, description } = parsed.data;

        const created_by = sessionUser.id;

        if (convType === 'channel') {
            await requireCreateChannel(workspace_id, created_by);
            const channelCheck = await checkChannelLimit(workspace_id);
            if (!channelCheck.allowed) {
                return NextResponse.json({ error: channelCheck.error, code: channelCheck.code }, { status: 403 });
            }
        } else {
            await requireWorkspaceChatRead(workspace_id, created_by);
        }

        const participantIds = [...new Set([...(member_ids ?? []), created_by])];
        await assertWorkspaceMemberIds(workspace_id, participantIds);

        if (convType === 'dm' && member_ids && member_ids.length === 2) {
            const [uid1, uid2] = member_ids;
            const dmName = name || 'Direct Message';

            try {
                const atomic = await query<{
                    id: string;
                    name: string;
                    type: string;
                    workspace_id: string;
                    created_at: string;
                    description: string;
                    is_existing: boolean;
                }>(
                    `SELECT id, name, type, workspace_id, created_at, description, is_existing
                     FROM ${SCHEMA}.get_or_create_dm($1, $2, $3, $4, $5)`,
                    [workspace_id, uid1, uid2, created_by, dmName],
                );
                const row = atomic.rows[0];
                if (row) {
                    const { is_existing, ...conversation } = row;
                    return NextResponse.json(
                        { data: conversation, existing: is_existing },
                        { status: is_existing ? 200 : 201 },
                    );
                }
            } catch (fnErr: unknown) {
                const msg = fnErr instanceof Error ? fnErr.message : '';
                if (!msg.includes('get_or_create_dm') && !msg.includes('does not exist')) {
                    throw fnErr;
                }
            }

            const existing = await findExistingDm(workspace_id, uid1, uid2);
            if (existing) {
                return NextResponse.json({ data: existing, existing: true });
            }

            const convResult = await query<{
                id: string;
                name: string;
                type: string;
                workspace_id: string;
                created_at: string;
                description: string;
            }>(
                `INSERT INTO ${SCHEMA}.conversations (workspace_id, type, name, description, created_by)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, workspace_id, type, name, description, created_at`,
                [workspace_id, convType, dmName, description || '', created_by],
            );

            const conversation = convResult.rows[0];
            if (!conversation) throw new Error('Failed to create conversation');

            await query(
                `INSERT INTO ${SCHEMA}.conversation_members (conversation_id, user_id, role)
                 VALUES ($1, $2, 'admin')
                 ON CONFLICT (conversation_id, user_id) DO NOTHING`,
                [conversation.id, created_by],
            );

            for (const memberId of member_ids) {
                if (memberId !== created_by) {
                    await query(
                        `INSERT INTO ${SCHEMA}.conversation_members (conversation_id, user_id, role)
                         VALUES ($1, $2, 'member')
                         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
                        [conversation.id, memberId],
                    );
                }
            }

            return NextResponse.json({ data: conversation }, { status: 201 });
        }

        const convResult = await query<{ id: string; name: string; type: string; workspace_id: string; created_at: string; description: string }>(
            `INSERT INTO ${SCHEMA}.conversations (workspace_id, type, name, description, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, workspace_id, type, name, description, created_at`,
            [workspace_id, convType, name || 'general', description || '', created_by],
        );

        const conversation = convResult.rows[0];
        if (!conversation) throw new Error('Failed to create conversation');

        await query(
            `INSERT INTO ${SCHEMA}.conversation_members (conversation_id, user_id, role)
             VALUES ($1, $2, 'admin')
             ON CONFLICT (conversation_id, user_id) DO NOTHING`,
            [conversation.id, created_by],
        );

        if (convType === 'channel') {
            // Auto-add all current workspace members so the channel is visible to everyone
            const wsMembers = await query<{ user_id: string }>(
                `SELECT user_id FROM ${SCHEMA}.workspace_members WHERE workspace_id = $1`,
                [workspace_id],
            );
            for (const m of wsMembers.rows) {
                if (m.user_id !== created_by) {
                    await query(
                        `INSERT INTO ${SCHEMA}.conversation_members (conversation_id, user_id, role)
                         VALUES ($1, $2, 'member')
                         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
                        [conversation.id, m.user_id],
                    );
                }
            }
        } else if (member_ids && member_ids.length > 0) {
            for (const memberId of member_ids) {
                if (memberId !== created_by) {
                    await query(
                        `INSERT INTO ${SCHEMA}.conversation_members (conversation_id, user_id, role)
                         VALUES ($1, $2, 'member')
                         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
                        [conversation.id, memberId],
                    );
                }
            }
        }

        return NextResponse.json({ data: conversation }, { status: 201 });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
