import {
    exchangeMicrosoftAuthorizationCode,
    fetchMicrosoftPrimaryEmail,
    refreshMicrosoftAccessToken,
} from '@/lib/email/oauth/microsoft';

import { chatPluginHistoryMaxPages, chatPluginHistoryOldestMs } from './history-config';
import { chatPluginOAuthCallbackUrl } from './oauth';
import type { ExternalChannelItem, ExternalChatMessage } from './types';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export const TEAMS_CHAT_SCOPES = [
    'ChannelMessage.Read.All',
    'ChannelMessage.Send',
    'Channel.ReadBasic.All',
    'Team.ReadBasic.All',
    'User.Read',
    'offline_access',
].join(' ');

export function teamsOAuthAuthorizeUrl(state: string): string {
    const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
    if (!clientId) throw new Error('MICROSOFT_OAUTH_CLIENT_ID is not configured');
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: chatPluginOAuthCallbackUrl('teams'),
        scope: TEAMS_CHAT_SCOPES,
        state,
        prompt: 'consent',
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeTeamsOAuthCode(code: string) {
    const data = await exchangeMicrosoftAuthorizationCode(code, chatPluginOAuthCallbackUrl('teams'));
    const email = await fetchMicrosoftPrimaryEmail(data.access_token);
    const profile = await graphGet<{
        id: string;
        displayName?: string;
        mail?: string;
    }>(data.access_token, '/me');
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresIn: data.expires_in,
        teamId: profile.id,
        teamName: profile.displayName ?? email,
        botUserId: profile.id,
        accountEmail: email,
    };
}

export async function refreshTeamsAccessToken(refreshToken: string) {
    return refreshMicrosoftAccessToken(refreshToken);
}

async function graphGet<T>(accessToken: string, path: string): Promise<T> {
    const res = await fetch(`${GRAPH}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) {
        throw new Error(data.error?.message || `Microsoft Graph ${path} failed`);
    }
    return data;
}

export function parseTeamsChannelRef(externalChannelId: string): { teamId: string; channelId: string } {
    const idx = externalChannelId.indexOf(':');
    if (idx <= 0) throw new Error('Invalid Teams channel reference');
    return {
        teamId: externalChannelId.slice(0, idx),
        channelId: externalChannelId.slice(idx + 1),
    };
}

export function formatTeamsChannelRef(teamId: string, channelId: string): string {
    return `${teamId}:${channelId}`;
}

export async function listTeamsChannels(accessToken: string): Promise<ExternalChannelItem[]> {
    const teamsData = await graphGet<{ value?: Array<{ id: string; displayName?: string }> }>(
        accessToken,
        '/me/joinedTeams',
    );
    const channels: ExternalChannelItem[] = [];
    for (const team of teamsData.value ?? []) {
        const chData = await graphGet<{
            value?: Array<{ id: string; displayName?: string; membershipType?: string }>;
        }>(accessToken, `/teams/${team.id}/channels`);
        for (const ch of chData.value ?? []) {
            channels.push({
                id: formatTeamsChannelRef(team.id, ch.id),
                name: ch.displayName ?? 'channel',
                isPrivate: ch.membershipType === 'private',
                subtitle: team.displayName ?? undefined,
            });
        }
    }
    return channels.sort((a, b) => {
        const aKey = `${a.subtitle ?? ''}/${a.name}`;
        const bKey = `${b.subtitle ?? ''}/${b.name}`;
        return aKey.localeCompare(bKey);
    });
}

type GraphTeamsMessage = {
    id: string;
    body?: { content?: string };
    from?: { user?: { id?: string; displayName?: string } };
    createdDateTime?: string;
};

function mapTeamsMessage(m: GraphTeamsMessage, threadParentExternalId?: string): ExternalChatMessage {
    return {
        externalId: m.id,
        text: stripHtml(m.body?.content ?? ''),
        senderExternalId: m.from?.user?.id,
        createdAt: m.createdDateTime,
        threadParentExternalId,
    };
}

export async function fetchTeamsChannelHistory(
    accessToken: string,
    externalChannelId: string,
    sinceUnix?: string,
): Promise<ExternalChatMessage[]> {
    const { teamId, channelId } = parseTeamsChannelRef(externalChannelId);
    const oldestMs = sinceUnix ? parseFloat(sinceUnix) * 1000 : chatPluginHistoryOldestMs();
    const out: ExternalChatMessage[] = [];
    let nextPath: string | null = `/teams/${teamId}/channels/${channelId}/messages?$top=50`;
    let pages = 0;
    const maxPages = chatPluginHistoryMaxPages();

    while (nextPath && pages < maxPages) {
        const graphPath: string = nextPath.startsWith('http') ? nextPath.replace(GRAPH, '') : nextPath;
        const data = await graphGet<{ value?: GraphTeamsMessage[]; '@odata.nextLink'?: string }>(
            accessToken,
            graphPath,
        );
        let reachedHistoryEnd = false;
        for (const m of data.value ?? []) {
            const ts = m.createdDateTime ? new Date(m.createdDateTime).getTime() : 0;
            if (ts > 0 && ts < oldestMs) {
                reachedHistoryEnd = true;
                break;
            }
            if (!m.body?.content?.trim()) continue;
            out.push(mapTeamsMessage(m));
            try {
                let repliesPath: string | null =
                    `/teams/${teamId}/channels/${channelId}/messages/${m.id}/replies?$top=50`;
                while (repliesPath) {
                    const repliesGraphPath: string = repliesPath.startsWith('http')
                        ? repliesPath.replace(GRAPH, '')
                        : repliesPath;
                    const replies = await graphGet<{
                        value?: GraphTeamsMessage[];
                        '@odata.nextLink'?: string;
                    }>(accessToken, repliesGraphPath);
                    for (const r of replies.value ?? []) {
                        if (!r.body?.content?.trim()) continue;
                        out.push(mapTeamsMessage(r, m.id));
                    }
                    const rawRepliesNext = replies['@odata.nextLink'];
                    repliesPath = rawRepliesNext ? rawRepliesNext.replace(GRAPH, '') : null;
                }
            } catch {
                /* replies optional */
            }
        }
        if (reachedHistoryEnd) break;
        const rawNext = data['@odata.nextLink'];
        nextPath = rawNext ? rawNext.replace(GRAPH, '') : null;
        pages += 1;
    }
    return out;
}

export async function postTeamsMessage(
    accessToken: string,
    externalChannelId: string,
    text: string,
    threadParentExternalId?: string,
): Promise<string> {
    const { teamId, channelId } = parseTeamsChannelRef(externalChannelId);
    const path = threadParentExternalId
        ? `/teams/${teamId}/channels/${channelId}/messages/${threadParentExternalId}/replies`
        : `/teams/${teamId}/channels/${channelId}/messages`;
    const res = await fetch(`${GRAPH}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            body: { contentType: 'text', content: text.trim() },
        }),
    });
    const data = (await res.json()) as { id?: string; error?: { message?: string } };
    if (!res.ok || !data.id) {
        throw new Error(data.error?.message || 'Failed to post Teams message');
    }
    return data.id;
}

export async function fetchTeamsMessageByResource(
    accessToken: string,
    resourcePath: string,
): Promise<ExternalChatMessage | null> {
    const path = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
    try {
        const m = await graphGet<GraphTeamsMessage>(accessToken, path);
        if (!m.id || !m.body?.content?.trim()) return null;
        return mapTeamsMessage(m);
    } catch {
        return null;
    }
}

export async function fetchTeamsUserEmail(
    accessToken: string,
    userId: string,
): Promise<string | null> {
    try {
        const data = await graphGet<{ mail?: string; userPrincipalName?: string }>(
            accessToken,
            `/users/${userId}`,
        );
        const email = (data.mail || data.userPrincipalName || '').trim().toLowerCase();
        return email.includes('@') ? email : null;
    } catch {
        return null;
    }
}

function stripHtml(html: string): string {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
