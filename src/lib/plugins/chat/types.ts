export type ChatPluginProvider = 'slack' | 'teams' | 'discord';

export interface ExternalChannelItem {
    id: string;
    name: string;
    isPrivate: boolean;
    subtitle?: string;
}

export interface ExternalChatMessage {
    externalId: string;
    text: string;
    senderExternalId?: string;
    botId?: string;
    createdAt?: string;
    /** Parent message id in the external system (Slack thread_ts, Teams/Discord parent id). */
    threadParentExternalId?: string;
    alsoSentToChannel?: boolean;
}

export interface PostChatMessageOptions {
    threadParentExternalId?: string;
    alsoSendToChannel?: boolean;
}

export type PluginMessageSyncOrigin = 'import' | 'export';

export interface ChatPluginInstallationRow {
    id: string;
    workspace_id: string;
    installed_by: string;
    provider: ChatPluginProvider;
    team_id: string;
    team_name: string | null;
    bot_user_id: string | null;
    encrypted_token: string;
    encrypted_refresh: string | null;
    status: 'connected' | 'error' | 'revoked';
    settings: Record<string, unknown>;
    sync_cursor: Record<string, unknown>;
    last_synced_at: string | null;
    last_sync_error: string | null;
    created_at: string;
    updated_at: string;
}

export interface PluginConversationLinkRow {
    id: string;
    installation_id: string;
    conversation_id: string;
    external_channel_id: string;
    external_channel_name: string | null;
    created_at: string;
    updated_at: string;
}

export interface PluginMessageLinkRow {
    id: string;
    installation_id: string;
    message_id: string;
    external_message_id: string;
    sync_origin: PluginMessageSyncOrigin;
    created_at: string;
}

export interface ChatPluginStatus {
    provider: ChatPluginProvider;
    connected: boolean;
    teamName: string | null;
    status: 'connected' | 'error' | 'revoked' | 'disconnected';
    lastSyncedAt: string | null;
    lastSyncError: string | null;
}

/** @deprecated Use ExternalChannelItem */
export type SlackChannelItem = ExternalChannelItem;

export interface ConversationLinkDTO {
    id: string;
    conversationId: string;
    conversationName: string | null;
    provider: ChatPluginProvider;
    externalChannelId: string;
    externalChannelName: string | null;
}
