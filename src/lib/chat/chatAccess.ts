import { query, SCHEMA } from "@/lib/db";
import {
    getWorkspaceMembership,
    memberCan,
    requireWorkspaceMember,
} from "@/lib/rbac/workspace-access";

export class ChatAccessError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ChatAccessError";
    }
}

export type ConversationAccess = {
  conversationId: string;
  workspaceId: string;
  type: string;
  name: string | null;
  lastReadAt: string | null;
};

/** Caller must be an active member of the conversation. */
export async function loadConversationForMember(
  conversationId: string,
  userId: string,
): Promise<ConversationAccess | null> {
  const res = await query<{
    conversation_id: string;
    workspace_id: string;
    type: string;
    name: string | null;
    last_read_at: string | null;
  }>(
    `SELECT c.id AS conversation_id, c.workspace_id, c.type, c.name, cm.last_read_at
     FROM ${SCHEMA}.conversations c
     INNER JOIN ${SCHEMA}.conversation_members cm
       ON cm.conversation_id = c.id AND cm.user_id = $2 AND cm.left_at IS NULL
     WHERE c.id = $1 AND c.archived_at IS NULL
     LIMIT 1`,
    [conversationId, userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    conversationId: row.conversation_id,
    workspaceId: row.workspace_id,
    type: row.type,
    name: row.name,
    lastReadAt: row.last_read_at,
  };
}

export type ChatMessageRow = {
  id: string;
  sender_id: string;
  sender_name: string | null;
  content: string;
  created_at: string;
};

export async function loadMessagesForAi(
  conversationId: string,
  opts: { since?: string | null; limit?: number },
): Promise<ChatMessageRow[]> {
  const limit = Math.min(opts.limit ?? 80, 100);
  const params: unknown[] = [conversationId];
  let sinceClause = "";
  if (opts.since) {
    params.push(opts.since);
    sinceClause = ` AND m.created_at > $${params.length}::timestamptz`;
  }
  params.push(limit);
  const res = await query<ChatMessageRow>(
    `SELECT m.id, m.sender_id, p.full_name AS sender_name, m.content, m.created_at
     FROM ${SCHEMA}.messages m
     LEFT JOIN ${SCHEMA}.profiles p ON p.id = m.sender_id
     WHERE m.conversation_id = $1
       AND m.deleted_at IS NULL
       ${sinceClause}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return res.rows.reverse();
}

/** Active conversation member (read/post in thread). */
export async function requireConversationMember(
    conversationId: string,
    userId: string,
): Promise<ConversationAccess> {
    const access = await loadConversationForMember(conversationId, userId);
    if (!access) {
        throw new ChatAccessError("You are not a member of this conversation.");
    }
    return access;
}

/**
 * For channels: any workspace member can access full history; auto-joins them if needed.
 * For DMs: strict membership required.
 * Single CTE query — replaces 4 sequential round-trips.
 */
export async function requireConversationAccess(
    conversationId: string,
    userId: string,
): Promise<ConversationAccess> {
    const result = await query<{
        conversation_id: string;
        workspace_id: string;
        type: string;
        name: string | null;
        last_read_at: string | null;
        has_access: boolean;
    }>(`
        WITH conv_info AS (
            SELECT
                c.id              AS conversation_id,
                c.workspace_id,
                c.type,
                c.name,
                cm.last_read_at,
                (wm.user_id IS NOT NULL) AS is_workspace_member,
                (cm.user_id IS NOT NULL) AS is_conv_member
            FROM ${SCHEMA}.conversations c
            LEFT JOIN ${SCHEMA}.workspace_members wm
                ON wm.workspace_id = c.workspace_id
               AND wm.user_id     = $2
            LEFT JOIN ${SCHEMA}.conversation_members cm
                ON cm.conversation_id = c.id
               AND cm.user_id         = $2
               AND cm.left_at         IS NULL
            WHERE c.id = $1 AND c.archived_at IS NULL
            LIMIT 1
        ),
        auto_join AS (
            INSERT INTO ${SCHEMA}.conversation_members (conversation_id, user_id, role)
            SELECT $1, $2, 'member'
            FROM conv_info
            WHERE type != 'dm'
              AND is_workspace_member
              AND NOT is_conv_member
            ON CONFLICT (conversation_id, user_id) DO NOTHING
        )
        SELECT
            conversation_id,
            workspace_id,
            type,
            name,
            last_read_at,
            CASE WHEN type = 'dm' THEN is_conv_member
                 ELSE is_workspace_member
            END AS has_access
        FROM conv_info
    `, [conversationId, userId]);

    const row = result.rows[0];
    if (!row) throw new ChatAccessError('Conversation not found.');
    if (!row.has_access) {
        throw new ChatAccessError(
            row.type === 'dm'
                ? 'You are not a member of this conversation.'
                : 'You are not a member of this workspace.',
        );
    }
    return {
        conversationId: row.conversation_id,
        workspaceId:    row.workspace_id,
        type:           row.type,
        name:           row.name,
        lastReadAt:     row.last_read_at,
    };
}

export async function getConversationWorkspaceId(conversationId: string): Promise<string | null> {
    const res = await query<{ workspace_id: string }>(
        `SELECT workspace_id FROM ${SCHEMA}.conversations WHERE id = $1 LIMIT 1`,
        [conversationId],
    );
    return res.rows[0]?.workspace_id ?? null;
}

/** Message must belong to a conversation the user can access. */
export async function requireMessageAccess(
    messageId: string,
    userId: string,
): Promise<ConversationAccess> {
    const res = await query<{ conversation_id: string }>(
        `SELECT conversation_id FROM ${SCHEMA}.messages WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [messageId],
    );
    const conversationId = res.rows[0]?.conversation_id;
    if (!conversationId) {
        throw new ChatAccessError("Message not found.");
    }
    return requireConversationAccess(conversationId, userId);
}

/** List/create conversations in a workspace. */
export async function requireWorkspaceChatRead(workspaceId: string, userId: string) {
    return requireWorkspaceMember(workspaceId, userId);
}

export async function requireCreateChannel(workspaceId: string, userId: string) {
    const membership = await requireWorkspaceMember(workspaceId, userId);
    if (!memberCan(membership, "create_channels")) {
        throw new ChatAccessError("You do not have permission to create channels.");
    }
    return membership;
}

export async function requireManageBotIntegrations(workspaceId: string, userId: string) {
    const membership = await requireWorkspaceMember(workspaceId, userId);
    if (!memberCan(membership, 'manage_bot_integrations')) {
        throw new ChatAccessError('You do not have permission to manage chat plugins.');
    }
    return membership;
}

export async function requireModerateContent(
    conversationId: string,
    userId: string,
): Promise<ConversationAccess> {
    const access = await requireConversationMember(conversationId, userId);
    const membership = await getWorkspaceMembership(access.workspaceId, userId);
    if (!membership || !memberCan(membership, "moderate_content")) {
        throw new ChatAccessError("You do not have permission to moderate messages.");
    }
    return access;
}

/** Target users must be members of the workspace (for DM/channel invites). */
export async function assertWorkspaceMemberIds(
    workspaceId: string,
    userIds: string[],
): Promise<void> {
    if (userIds.length === 0) return;
    const res = await query<{ user_id: string }>(
        `SELECT user_id FROM ${SCHEMA}.workspace_members
         WHERE workspace_id = $1 AND user_id = ANY($2::uuid[])`,
        [workspaceId, userIds],
    );
    if (res.rows.length !== userIds.length) {
        throw new ChatAccessError("All participants must be workspace members.");
    }
}
