import { query, SCHEMA } from "@/lib/db";

/** Post a system line in the linked chat conversation (best-effort). */
export async function postCallChatSystemMessage(
  conversationId: string | null | undefined,
  senderUserId: string,
  content: string,
): Promise<void> {
  if (!conversationId?.trim() || !senderUserId) return;
  try {
    await query(
      `INSERT INTO ${SCHEMA}.messages
         (conversation_id, sender_id, content, type)
       VALUES ($1, $2, $3, 'system')`,
      [conversationId, senderUserId, content],
    );
  } catch {
    /* non-blocking */
  }
}

async function findDmConversationId(
  workspaceId: string,
  userId1: string,
  userId2: string,
): Promise<string | null> {
  const res = await query<{ id: string }>(
    `SELECT c.id
     FROM ${SCHEMA}.conversations c
     JOIN ${SCHEMA}.conversation_members cm1
       ON cm1.conversation_id = c.id AND cm1.user_id = $1 AND cm1.left_at IS NULL
     JOIN ${SCHEMA}.conversation_members cm2
       ON cm2.conversation_id = c.id AND cm2.user_id = $2 AND cm2.left_at IS NULL
     WHERE c.workspace_id = $3 AND c.type = 'dm'
     LIMIT 1`,
    [userId1, userId2, workspaceId],
  );
  return res.rows[0]?.id ?? null;
}

async function ensureDmConversation(
  workspaceId: string,
  hostUserId: string,
  inviteeId: string,
): Promise<string | null> {
  const existing = await findDmConversationId(
    workspaceId,
    hostUserId,
    inviteeId,
  );
  if (existing) return existing;

  try {
    const convRes = await query<{ id: string }>(
      `INSERT INTO ${SCHEMA}.conversations (workspace_id, type, name, created_by)
       VALUES ($1, 'dm', 'Direct Message', $2)
       RETURNING id`,
      [workspaceId, hostUserId],
    );
    const conversationId = convRes.rows[0]?.id;
    if (!conversationId) return null;

    for (const uid of [hostUserId, inviteeId]) {
      await query(
        `INSERT INTO ${SCHEMA}.conversation_members (conversation_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [conversationId, uid, uid === hostUserId ? "admin" : "member"],
      );
    }
    return conversationId;
  } catch {
    return null;
  }
}

async function postInviteMessage(
  conversationId: string,
  hostUserId: string,
  content: string,
): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.messages (conversation_id, sender_id, content, type)
     VALUES ($1, $2, $3, 'text')`,
    [conversationId, hostUserId, content],
  );
}

/** Notify invitees via linked channel and/or DM with join link (best-effort). */
export async function postCallInviteMessages(
  workspaceId: string,
  hostUserId: string,
  callId: string,
  title: string,
  inviteeIds: string[],
  conversationId?: string | null,
): Promise<void> {
  const appBase =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    "http://localhost:3000";
  const joinUrl = `${appBase}/calls/${callId}/room`;
  const line = `Invited you to a video call: "${title}". Join here: ${joinUrl}`;

  const hostProfile = await query<{ full_name: string | null }>(
    `SELECT full_name FROM ${SCHEMA}.profiles WHERE id = $1 LIMIT 1`,
    [hostUserId],
  );
  const hostName = hostProfile.rows[0]?.full_name?.trim() || "Someone";
  const dmLine = `${hostName} ${line}`;

  if (conversationId?.trim()) {
    await postCallChatSystemMessage(
      conversationId,
      hostUserId,
      `${hostName} started a call: "${title}". ${joinUrl}`,
    );
  }

  for (const inviteeId of inviteeIds) {
    if (inviteeId === hostUserId) continue;
    try {
      const dmId = await ensureDmConversation(
        workspaceId,
        hostUserId,
        inviteeId,
      );
      if (dmId) {
        await postInviteMessage(dmId, hostUserId, dmLine);
      }
    } catch {
      /* non-blocking per invitee */
    }
  }
}
