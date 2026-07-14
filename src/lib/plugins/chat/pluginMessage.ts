export const CHAT_PLUGIN_MESSAGE_SOURCES = ['slack', 'teams', 'discord'] as const;

export type ChatPluginMessageSource = (typeof CHAT_PLUGIN_MESSAGE_SOURCES)[number];

export function isPluginSourcedMessage(metadata?: { source?: string } | null): boolean {
    const source = metadata?.source;
    return CHAT_PLUGIN_MESSAGE_SOURCES.includes(source as ChatPluginMessageSource);
}

export function getPluginMessageSource(
    metadata?: { source?: string } | null,
): ChatPluginMessageSource | null {
    const source = metadata?.source;
    if (CHAT_PLUGIN_MESSAGE_SOURCES.includes(source as ChatPluginMessageSource)) {
        return source as ChatPluginMessageSource;
    }
    return null;
}
