import type { ChatPluginProviderHandler } from './provider';
import { discordChatPlugin } from './discord-plugin';
import { slackChatPlugin } from './slack-plugin';
import { teamsChatPlugin } from './teams-plugin';
import type { ChatPluginProvider } from './types';

const handlers: Record<ChatPluginProvider, ChatPluginProviderHandler> = {
    slack: slackChatPlugin,
    teams: teamsChatPlugin,
    discord: discordChatPlugin,
};

export function getChatPluginHandler(provider: ChatPluginProvider): ChatPluginProviderHandler {
    const handler = handlers[provider];
    if (!handler) throw new Error(`No chat plugin handler for ${provider}`);
    return handler;
}

export function isChatPluginProvider(value: string): value is ChatPluginProvider {
    return value === 'slack' || value === 'teams' || value === 'discord';
}
