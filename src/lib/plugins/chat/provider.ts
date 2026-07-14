import type {
    ChatPluginInstallationRow,
    ChatPluginProvider,
    ExternalChannelItem,
    ExternalChatMessage,
    PostChatMessageOptions,
} from './types';

export interface ChatPluginProviderHandler {
    readonly provider: ChatPluginProvider;
    listChannels(
        installation: ChatPluginInstallationRow,
        accessToken: string,
    ): Promise<ExternalChannelItem[]>;
    fetchChannelHistory(
        accessToken: string,
        externalChannelId: string,
        since?: string,
    ): Promise<ExternalChatMessage[]>;
    postMessage(
        accessToken: string,
        externalChannelId: string,
        text: string,
        options?: PostChatMessageOptions,
    ): Promise<string>;
    resolveSender(
        installation: ChatPluginInstallationRow,
        accessToken: string,
        message: ExternalChatMessage,
    ): Promise<{ userId: string; displayName: string | null }>;
    shouldSkipInbound?(installation: ChatPluginInstallationRow, message: ExternalChatMessage): boolean;
}
