import { chatPluginHistoryMaxPages, chatPluginHistoryOldestMs } from './history-config';
import { chatPluginOAuthCallbackUrl } from './oauth';
import type { ExternalChannelItem, ExternalChatMessage } from './types';

const DISCORD_API = 'https://discord.com/api/v10';

/** View channels + send messages + read message history */
export const DISCORD_BOT_PERMISSIONS = '68608';

export function discordOAuthAuthorizeUrl(state: string): string {
    const clientId = process.env.DISCORD_APPLICATION_ID?.trim();
    if (!clientId) throw new Error('DISCORD_APPLICATION_ID is not configured');
    const params = new URLSearchParams({
        client_id: clientId,
        scope: 'bot identify',
        permissions: DISCORD_BOT_PERMISSIONS,
        redirect_uri: chatPluginOAuthCallbackUrl('discord'),
        response_type: 'code',
        state,
    });
    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

export function discordBotToken(): string {
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    if (!token) throw new Error('DISCORD_BOT_TOKEN is not configured');
    return token;
}

export async function exchangeDiscordOAuthCode(code: string, guildId: string | null) {
    const clientId = process.env.DISCORD_APPLICATION_ID?.trim();
    const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('Discord OAuth is not configured');
    if (!guildId) throw new Error('Discord guild was not authorized');

    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: chatPluginOAuthCallbackUrl('discord'),
        }).toString(),
    });
    const data = (await res.json()) as { access_token?: string; error?: string };
    if (!res.ok) throw new Error(data.error || 'Discord OAuth exchange failed');

    const botToken = discordBotToken();
    const guild = await discordGet<{ name?: string; id: string }>(botToken, `/guilds/${guildId}`);
    return {
        accessToken: botToken,
        teamId: guildId,
        teamName: guild.name ?? 'Discord server',
        botUserId: null as string | null,
    };
}

async function discordGet<T>(token: string, path: string): Promise<T> {
    const res = await fetch(`${DISCORD_API}${path}`, {
        headers: { Authorization: `Bot ${token}` },
    });
    const data = (await res.json()) as T & { message?: string };
    if (!res.ok) throw new Error(data.message || `Discord API ${path} failed`);
    return data;
}

export async function listDiscordGuildChannels(
    guildId: string,
    token: string,
): Promise<ExternalChannelItem[]> {
    const data = await discordGet<Array<{ id: string; name: string; type: number }>>(
        token,
        `/guilds/${guildId}/channels`,
    );
    return data
        .filter((ch) => ch.type === 0 || ch.type === 5)
        .map((ch) => ({
            id: ch.id,
            name: ch.name,
            isPrivate: false,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

type DiscordApiMessage = {
    id: string;
    content?: string;
    author?: { id?: string; bot?: boolean };
    timestamp?: string;
    message_reference?: { message_id?: string };
};

export async function fetchDiscordChannelHistory(
    token: string,
    channelId: string,
    sinceUnix?: string,
): Promise<ExternalChatMessage[]> {
    const oldestMs = sinceUnix ? parseFloat(sinceUnix) * 1000 : chatPluginHistoryOldestMs();
    const collected: DiscordApiMessage[] = [];
    let before: string | undefined;
    const maxPages = chatPluginHistoryMaxPages();

    for (let page = 0; page < maxPages; page += 1) {
        const path = before
            ? `/channels/${channelId}/messages?limit=100&before=${before}`
            : `/channels/${channelId}/messages?limit=100`;
        const batch = await discordGet<DiscordApiMessage[]>(token, path);
        if (!batch?.length) break;

        let reachedHistoryEnd = false;
        for (const m of batch) {
            const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
            if (ts > 0 && ts < oldestMs) {
                reachedHistoryEnd = true;
                break;
            }
            collected.push(m);
        }

        if (reachedHistoryEnd || batch.length < 100) break;
        before = batch[batch.length - 1]?.id;
        if (!before) break;
    }

    return collected
        .filter((m) => m.content?.trim() && !m.author?.bot)
        .reverse()
        .map((m) => ({
            externalId: m.id,
            text: m.content ?? '',
            senderExternalId: m.author?.id,
            botId: m.author?.bot ? m.author.id : undefined,
            createdAt: m.timestamp,
            threadParentExternalId: m.message_reference?.message_id,
        }));
}

export async function postDiscordMessage(
    token: string,
    channelId: string,
    text: string,
    threadParentExternalId?: string,
): Promise<string> {
    const body: Record<string, unknown> = { content: text.trim() };
    if (threadParentExternalId) {
        body.message_reference = { message_id: threadParentExternalId };
    }
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const data = (await res.json()) as { id?: string; message?: string };
    if (!res.ok || !data.id) throw new Error(data.message || 'Failed to post Discord message');
    return data.id;
}

export async function fetchDiscordUserEmail(
    token: string,
    userId: string,
    guildId: string,
): Promise<string | null> {
    try {
        const member = await discordGet<{ user?: { id?: string }; nick?: string }>(
            token,
            `/guilds/${guildId}/members/${userId}`,
        );
        void member;
        return null;
    } catch {
        return null;
    }
}
