import type { ChatPluginProviderHandler } from './provider';
import type { ChatPluginInstallationRow, ExternalChatMessage } from './types';
import {
    fetchDiscordChannelHistory,
    listDiscordGuildChannels,
    postDiscordMessage,
} from './discord';

export const discordChatPlugin: ChatPluginProviderHandler = {
    provider: 'discord',

    listChannels(installation, accessToken) {
        return listDiscordGuildChannels(installation.team_id, accessToken);
    },

    fetchChannelHistory(accessToken, externalChannelId, since) {
        return fetchDiscordChannelHistory(accessToken, externalChannelId, since);
    },

    postMessage(accessToken, externalChannelId, text, options) {
        return postDiscordMessage(
            accessToken,
            externalChannelId,
            text,
            options?.threadParentExternalId,
        );
    },

    async resolveSender(installation, _accessToken, message) {
        return {
            userId: installation.installed_by,
            displayName: message.senderExternalId ? 'Discord user' : 'Discord',
        };
    },

    shouldSkipInbound(_installation, message) {
        return Boolean(message.botId);
    },
};
