/**
 * GET /api/chat/messages/recent?workspaceId=
 */
import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { requireWorkspaceChatRead } from '@/lib/chat/chatAccess';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RecentMessageRow {
    id: string;
    content: string;
    created_at: string;
    sender: {
        full_name: string | null;
        avatar_url: string | null;
    } | null;
}

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspaceId');

        if (!workspaceId || !UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }

        await requireWorkspaceChatRead(workspaceId, user.id);

        const result = await query<RecentMessageRow>(
            `SELECT
                m.id,
                m.content,
                m.created_at,
                json_build_object(
                    'full_name', p.full_name,
                    'avatar_url', p.avatar_url
                ) AS sender
             FROM ${SCHEMA}.messages m
             INNER JOIN ${SCHEMA}.conversations c
                ON c.id = m.conversation_id
             INNER JOIN ${SCHEMA}.conversation_members cm
                ON cm.conversation_id = c.id
               AND cm.user_id = $2
               AND cm.left_at IS NULL
             LEFT JOIN ${SCHEMA}.profiles p
                ON p.id = m.sender_id
             WHERE c.workspace_id = $1
               AND c.archived_at IS NULL
               AND m.deleted_at IS NULL
             ORDER BY m.created_at DESC
             LIMIT 3`,
            [workspaceId, user.id],
        );

        return NextResponse.json({ data: result.rows });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
