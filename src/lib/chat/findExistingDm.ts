import { query, SCHEMA } from '@/lib/db';

export type ExistingDmRow = {
    id: string;
    name: string;
    type: string;
    workspace_id: string;
    created_at: string;
    description?: string;
};

/** Find a DM between two users regardless of member_ids order. */
export async function findExistingDm(
    workspaceId: string,
    userA: string,
    userB: string,
): Promise<ExistingDmRow | null> {
    const result = await query<ExistingDmRow>(
        `SELECT c.id, c.name, c.type, c.workspace_id, c.created_at, c.description
         FROM ${SCHEMA}.conversations c
         WHERE c.workspace_id = $1
           AND c.type = 'dm'
           AND c.archived_at IS NULL
           AND EXISTS (
             SELECT 1 FROM ${SCHEMA}.conversation_members cm
             WHERE cm.conversation_id = c.id AND cm.user_id = $2 AND cm.left_at IS NULL
           )
           AND EXISTS (
             SELECT 1 FROM ${SCHEMA}.conversation_members cm
             WHERE cm.conversation_id = c.id AND cm.user_id = $3 AND cm.left_at IS NULL
           )
         ORDER BY c.created_at ASC
         LIMIT 1`,
        [workspaceId, userA, userB],
    );
    return result.rows[0] ?? null;
}
