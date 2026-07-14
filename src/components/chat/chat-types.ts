import type { ChatAttachment } from './ChatInput';
import { getPluginMessageSource } from '@/lib/plugins/chat/pluginMessage';

export type ChatMessageMetadata = {
    reactions?: Record<string, string[]>;
    attachments?: ChatAttachment[];
    source?: string;
    externalDisplayName?: string;
    externalUserId?: string;
    mentionLabels?: Record<string, string>;
};

/** Toggle a user's reaction on a message metadata object (optimistic UI). */
export function toggleReactionInMetadata(
    metadata: ChatMessageMetadata | undefined,
    emoji: string,
    userId: string,
): ChatMessageMetadata {
    const reactions: Record<string, string[]> = { ...(metadata?.reactions ?? {}) };
    const userList = reactions[emoji] ?? [];
    if (userList.includes(userId)) {
        const next = userList.filter((u) => u !== userId);
        if (next.length === 0) {
            delete reactions[emoji];
        } else {
            reactions[emoji] = next;
        }
    } else {
        reactions[emoji] = [...userList, userId];
    }
    return { ...metadata, reactions };
}

export type ReplyUserPreview = {
    userId: string;
    avatarUrl?: string;
    fullName?: string;
};

export type ChatMessage = {
    id: string;
    senderId: string;
    senderName?: string;
    senderAvatar?: string;
    content: string;
    timestamp: string;
    createdAt?: string;
    status?: 'sending' | 'sent' | 'failed' | 'deleted';
    replyToMessageId?: string;
    replyToContent?: string;
    replyToSenderName?: string;
    threadRootMessageId?: string;
    alsoSentToChannel?: boolean;
    replyCount?: number;
    lastReplyAt?: string;
    replyUsers?: ReplyUserPreview[];
    clientMessageId?: string;
    metadata?: ChatMessageMetadata;
    updatedAt?: string;
    deletedAt?: string;
};

/** Messages that belong in the main channel timeline (not thread-only replies). */
export function isChannelTimelineMessage(
    m: Pick<ChatMessage, 'threadRootMessageId' | 'alsoSentToChannel'>,
): boolean {
    return !m.threadRootMessageId || Boolean(m.alsoSentToChannel);
}

export function filterChannelTimelineMessages(msgs: ChatMessage[]): ChatMessage[] {
    return msgs.filter(isChannelTimelineMessage);
}

export function mapApiMessage(m: Record<string, unknown>): ChatMessage {
    const createdAt = m.created_at as string;
    const replyUsersRaw = m.reply_users as Array<Record<string, unknown>> | null | undefined;
    return {
        id: m.id as string,
        senderId: m.sender_id as string,
        senderName: (m.sender_name as string) || undefined,
        senderAvatar: (m.sender_avatar as string) || undefined,
        content: m.content as string,
        createdAt,
        timestamp: new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: m.deleted_at ? 'deleted' : 'sent',
        metadata: m.metadata as ChatMessageMetadata | undefined,
        updatedAt: m.updated_at as string | undefined,
        deletedAt: m.deleted_at as string | undefined,
        replyToMessageId: (m.reply_to_message_id as string) || undefined,
        threadRootMessageId: (m.thread_root_message_id as string) || undefined,
        alsoSentToChannel: Boolean(m.also_sent_to_channel),
        replyCount: typeof m.reply_count === 'number' ? m.reply_count : undefined,
        lastReplyAt: (m.last_reply_at as string) || undefined,
        replyUsers: Array.isArray(replyUsersRaw)
            ? replyUsersRaw.map((u) => ({
                userId: u.user_id as string,
                avatarUrl: (u.avatar_url as string) || undefined,
                fullName: (u.full_name as string) || undefined,
            }))
            : undefined,
        clientMessageId: (m.client_message_id as string) || undefined,
    };
}

export function resolveDisplayName(
    msg: Pick<ChatMessage, 'senderId' | 'senderName' | 'metadata'>,
    users: { id: string; name: string }[],
): string {
    const external = msg.metadata?.externalDisplayName?.trim();
    if (external && getPluginMessageSource(msg.metadata)) {
        return external;
    }
    return msg.senderName || users.find((u) => u.id === msg.senderId)?.name || msg.senderId.slice(0, 8);
}

export function resolveDisplayAvatar(
    msg: Pick<ChatMessage, 'senderId' | 'senderAvatar' | 'senderName'>,
    users: { id: string; avatar: string }[],
    displayName: string,
): string {
    return (
        msg.senderAvatar ||
        users.find((u) => u.id === msg.senderId)?.avatar ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1e293b&color=e2e8f0`
    );
}
