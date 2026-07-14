import { query, SCHEMA } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ThreadRootRow = {
    id: string;
    conversation_id: string;
    type: string;
    deleted_at: string | null;
    thread_root_message_id: string | null;
};

export async function resolveThreadRootMessageId(
    threadRootMessageId: string,
    conversationId: string,
): Promise<{ rootId: string; row: ThreadRootRow } | { error: string; status: number }> {
    if (!UUID_RE.test(threadRootMessageId)) {
        return { error: 'Invalid thread_root_message_id', status: 400 };
    }

    const rootResult = await query<ThreadRootRow>(
        `SELECT id, conversation_id, type, deleted_at, thread_root_message_id
         FROM ${SCHEMA}.messages
         WHERE id = $1`,
        [threadRootMessageId],
    );
    const row = rootResult.rows[0];
    if (!row) return { error: 'Thread parent message not found', status: 404 };
    if (row.conversation_id !== conversationId) {
        return { error: 'Thread parent does not belong to this conversation', status: 400 };
    }
    if (row.deleted_at) return { error: 'Cannot reply to a deleted message', status: 400 };
    if (row.type === 'system') return { error: 'Cannot thread on system messages', status: 400 };
    if (row.thread_root_message_id) {
        return { error: 'Cannot start a thread on a thread reply', status: 400 };
    }

    return { rootId: row.id, row };
}

export async function bumpThreadReplyStats(rootId: string, createdAt: string): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.messages
         SET reply_count = reply_count + 1,
             last_reply_at = $2
         WHERE id = $1`,
        [rootId, createdAt],
    );
}

export const CHANNEL_TIMELINE_FILTER = `
  AND (m.thread_root_message_id IS NULL OR m.also_sent_to_channel = true)
`;

export function messageSelectFields(alias = 'm'): string {
    return `
    ${alias}.id,
    ${alias}.conversation_id,
    ${alias}.sender_id,
    ${alias}.content,
    ${alias}.type,
    ${alias}.created_at,
    ${alias}.updated_at,
    ${alias}.deleted_at,
    ${alias}.reply_to_message_id,
    ${alias}.thread_root_message_id,
    ${alias}.also_sent_to_channel,
    ${alias}.reply_count,
    ${alias}.last_reply_at,
    ${alias}.pinned,
    ${alias}.metadata,
    ${alias}.client_message_id,
    p.full_name   AS sender_name,
    p.avatar_url  AS sender_avatar,
    p.email       AS sender_email`;
}

/** @deprecated use messageSelectFields('m') */
export const MESSAGE_SELECT_FIELDS = messageSelectFields('m');

export const replyUsersLateral = (parentAlias = 'm'): string => `
    COALESCE((
        SELECT json_agg(
            json_build_object(
                'user_id', ru.sender_id,
                'avatar_url', ru.avatar_url,
                'full_name', ru.full_name
            )
            ORDER BY ru.last_reply DESC
        )
        FROM (
            SELECT tr.sender_id, MAX(tr.created_at) AS last_reply, pr.avatar_url, pr.full_name
            FROM ${SCHEMA}.messages tr
            JOIN ${SCHEMA}.profiles pr ON pr.id = tr.sender_id
            WHERE tr.thread_root_message_id = ${parentAlias}.id
              AND tr.deleted_at IS NULL
            GROUP BY tr.sender_id, pr.avatar_url, pr.full_name
            ORDER BY last_reply DESC
            LIMIT 3
        ) ru
    ), '[]'::json) AS reply_users
`;

/** @deprecated use replyUsersLateral('m') */
export const REPLY_USERS_LATERAL = replyUsersLateral('m');
