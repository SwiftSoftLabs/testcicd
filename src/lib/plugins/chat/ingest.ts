import { query, SCHEMA } from '@/lib/db';
import { bumpThreadReplyStats } from '@/lib/chat/message-threads';
import { publishChatMessageInsert } from '@/lib/chat/realtime-publish';

import { getChatPluginHandler } from './registry';
import {
    createPluginMessageLink,
    findMessageIdByExternalLink,
    findPluginMessageLink,
} from './repository';
import { resolveSlackMrkdwnForStorage } from './slack-mrkdwn';
import { validChatPluginAccessToken } from './tokens';
import type { ChatPluginInstallationRow, ExternalChatMessage, PluginConversationLinkRow } from './types';

export async function ingestPluginMessage(
    installation: ChatPluginInstallationRow,
    link: PluginConversationLinkRow,
    message: ExternalChatMessage,
    slackMentionCache?: Map<string, string>,
): Promise<boolean> {
    if (!message.text?.trim()) return false;

    const handler = getChatPluginHandler(installation.provider);
    if (handler.shouldSkipInbound?.(installation, message)) return false;

    const existing = await findPluginMessageLink(installation.id, message.externalId);
    if (existing) return false;

    const token = await validChatPluginAccessToken(installation);
    const { userId, displayName } = await handler.resolveSender(installation, token, message);
    let threadRootMessageId: string | null = null;
    if (message.threadParentExternalId) {
        threadRootMessageId = await findMessageIdByExternalLink(
            installation.id,
            message.threadParentExternalId,
        );
    }

    let content = message.text.trim();
    let mentionLabels: Record<string, string> | undefined;
    if (installation.provider === 'slack') {
        const cache = slackMentionCache ?? new Map<string, string>();
        const resolved = await resolveSlackMrkdwnForStorage(content, token, cache);
        content = resolved.text;
        if (Object.keys(resolved.mentionLabels).length > 0) {
            mentionLabels = resolved.mentionLabels;
        }
    }

    const metadata = JSON.stringify({
        source: installation.provider,
        externalMessageId: message.externalId,
        externalUserId: message.senderExternalId ?? null,
        externalDisplayName: displayName,
        threadParentExternalId: message.threadParentExternalId ?? null,
        ...(mentionLabels ? { mentionLabels } : {}),
    });

    const result = await query<{
        id: string;
        conversation_id: string;
        sender_id: string;
        content: string;
        created_at: string;
        thread_root_message_id: string | null;
        also_sent_to_channel: boolean;
        metadata: Record<string, unknown> | null;
    }>(
        `INSERT INTO ${SCHEMA}.messages
            (conversation_id, sender_id, content, type, reply_to_message_id,
             thread_root_message_id, also_sent_to_channel, metadata)
         VALUES ($1, $2, $3, 'text', $4, $5, $6, $7::jsonb)
         RETURNING id, conversation_id, sender_id, content, created_at,
                   thread_root_message_id, also_sent_to_channel, metadata`,
        [
            link.conversation_id,
            userId,
            content,
            threadRootMessageId,
            threadRootMessageId,
            Boolean(message.alsoSentToChannel),
            metadata,
        ],
    );
    const row = result.rows[0];
    if (!row) return false;

    if (threadRootMessageId) {
        await bumpThreadReplyStats(threadRootMessageId, row.created_at);
    }

    await createPluginMessageLink({
        installationId: installation.id,
        messageId: row.id,
        externalMessageId: message.externalId,
        syncOrigin: 'import',
    });

    const profile = await query<{ full_name: string | null; avatar_url: string | null }>(
        `SELECT full_name, avatar_url FROM ${SCHEMA}.profiles WHERE id = $1`,
        [userId],
    );

    let threadRootReplyCount: number | null = null;
    let threadRootLastReplyAt: string | null = null;
    if (threadRootMessageId) {
        const stats = await query<{ reply_count: number; last_reply_at: string | null }>(
            `SELECT reply_count, last_reply_at FROM ${SCHEMA}.messages WHERE id = $1`,
            [threadRootMessageId],
        );
        threadRootReplyCount = stats.rows[0]?.reply_count ?? null;
        threadRootLastReplyAt = stats.rows[0]?.last_reply_at ?? null;
    }

    await publishChatMessageInsert(link.conversation_id, {
        id: row.id,
        conversation_id: link.conversation_id,
        sender_id: userId,
        sender_name: profile.rows[0]?.full_name ?? displayName,
        sender_avatar: profile.rows[0]?.avatar_url ?? null,
        content: row.content,
        created_at: row.created_at,
        thread_root_message_id: row.thread_root_message_id,
        also_sent_to_channel: row.also_sent_to_channel,
        thread_root_reply_count: threadRootReplyCount,
        thread_root_last_reply_at: threadRootLastReplyAt,
        metadata: row.metadata,
    });

    return true;
}

/** @deprecated Use ingestPluginMessage */
export async function ingestSlackMessage(
    installation: ChatPluginInstallationRow,
    link: PluginConversationLinkRow,
    slackMessage: { ts: string; user?: string; text?: string; bot_id?: string; thread_ts?: string },
): Promise<boolean> {
    return ingestPluginMessage(installation, link, {
        externalId: slackMessage.ts,
        text: slackMessage.text ?? '',
        senderExternalId: slackMessage.user,
        botId: slackMessage.bot_id,
        threadParentExternalId: slackMessage.thread_ts,
    });
}
