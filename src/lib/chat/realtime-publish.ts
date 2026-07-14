import { insforgeNative } from '@/lib/insforge/native';

export type ChatRealtimeMessagePayload = {
    id: string;
    conversation_id: string;
    sender_id: string;
    sender_name?: string | null;
    sender_avatar?: string | null;
    content: string;
    created_at: string;
    reply_to_message_id?: string | null;
    thread_root_message_id?: string | null;
    also_sent_to_channel?: boolean;
    thread_root_reply_count?: number | null;
    thread_root_last_reply_at?: string | null;
    client_message_id?: string | null;
    metadata?: Record<string, unknown> | null;
};

export type ChatRealtimeUpdatePayload = {
    id: string;
    conversation_id: string;
    content: string;
    metadata?: Record<string, unknown> | null;
    deleted_at?: string | null;
    updated_at?: string | null;
};

/** Best-effort server publish so webhook-ingested messages appear for connected clients. */
export async function publishChatMessageInsert(
    conversationId: string,
    payload: ChatRealtimeMessagePayload,
): Promise<void> {
    try {
        if (!insforgeNative.realtime.isConnected) {
            await insforgeNative.realtime.connect();
        }
        await insforgeNative.realtime.publish(`chat:${conversationId}`, 'INSERT_message', payload);
    } catch (err) {
        console.error('[chat/realtime-publish]', err);
    }
}

/** Best-effort publish so message edits, reactions, and deletes sync for connected clients. */
export async function publishChatMessageUpdate(
    conversationId: string,
    payload: ChatRealtimeUpdatePayload,
): Promise<void> {
    try {
        if (!insforgeNative.realtime.isConnected) {
            await insforgeNative.realtime.connect();
        }
        await insforgeNative.realtime.publish(`chat:${conversationId}`, 'UPDATE_message', payload);
    } catch (err) {
        console.error('[chat/realtime-publish]', err);
    }
}
