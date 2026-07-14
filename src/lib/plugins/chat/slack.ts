import crypto from 'crypto';

import { chatPluginHistoryMaxPages } from './history-config';
import { chatPluginOAuthCallbackUrl } from './oauth';
import type { SlackChannelItem } from './types';

const SLACK_HISTORY_PAGE_LIMIT = 200;

const SLACK_API = 'https://slack.com/api';

export const SLACK_BOT_SCOPES = [
    'channels:history',
    'channels:read',
    'channels:join',
    'chat:write',
    'groups:history',
    'groups:read',
    'users:read',
    'users:read.email',
    /** Granular scope — display names for @mentions (users.info profile fields) */
    'users.profile:read',
].join(',');

/** Slack API error codes when the bot is not a member of the channel. */
export const SLACK_NOT_IN_CHANNEL_ERRORS = new Set([
    'not_in_channel',
    'channel_not_found',
    'is_archived',
]);

export function isSlackNotInChannelError(error: unknown): boolean {
    return error instanceof Error && SLACK_NOT_IN_CHANNEL_ERRORS.has(error.message);
}

/** Errors where auto-join can be skipped (bot may already be in the channel). */
export function isSlackIgnorableJoinError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (isSlackNotInChannelError(error)) return true;
    if (error.message === 'missing_scope') return true;
    if (error.message === 'method_not_supported_for_channel_type') return true;
    return false;
}

export function isSlackMissingScopeError(error: unknown): boolean {
    return error instanceof Error && error.message === 'missing_scope';
}

export function slackReconnectForScopesMessage(): string {
    return (
        'Slack is missing required bot permissions. In api.slack.com → your app → OAuth & Permissions, ' +
        'add Bot Token Scopes: channels:history, channels:read, channels:join, chat:write, groups:history, ' +
        'groups:read, users:read, users:read.email, users.profile:read — then reinstall the app to your workspace. ' +
        'In OneWork: Settings → Plugins → Slack → Disconnect → Connect again.'
    );
}

export function formatSlackErrorForUser(error: unknown): string {
    if (isSlackMissingScopeError(error)) return slackReconnectForScopesMessage();
    if (error instanceof Error) return error.message;
    return 'Slack request failed';
}

export function slackNotInChannelUserMessage(channelName?: string): string {
    const where = channelName
        ? channelName.startsWith('#')
            ? ` ${channelName}`
            : ` #${channelName}`
        : ' this channel';
    return (
        `Channel linked, but the OneWork bot is not in${where} yet. ` +
        'In Slack, run /invite @OneWork (or your bot name) in that channel, then click Sync now.'
    );
}

export function slackOAuthAuthorizeUrl(state: string): string {
    const clientId = process.env.SLACK_CLIENT_ID?.trim();
    if (!clientId) throw new Error('SLACK_CLIENT_ID is not configured');
    const params = new URLSearchParams({
        client_id: clientId,
        scope: SLACK_BOT_SCOPES,
        redirect_uri: chatPluginOAuthCallbackUrl('slack'),
        state,
    });
    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeSlackOAuthCode(code: string) {
    const clientId = process.env.SLACK_CLIENT_ID?.trim();
    const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('Slack OAuth is not configured');
    const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: chatPluginOAuthCallbackUrl('slack'),
        }).toString(),
    });
    const data = (await res.json()) as {
        ok: boolean;
        access_token?: string;
        team?: { id: string; name?: string };
        bot_user_id?: string;
        error?: string;
    };
    if (!data.ok || !data.access_token || !data.team?.id) {
        throw new Error(data.error || 'Slack OAuth exchange failed');
    }
    return {
        accessToken: data.access_token,
        teamId: data.team.id,
        teamName: data.team.name ?? null,
        botUserId: data.bot_user_id ?? null,
    };
}

async function slackApi<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${SLACK_API}/${method}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as T & { ok?: boolean; error?: string };
    if (!(data as { ok?: boolean }).ok) {
        throw new Error((data as { error?: string }).error || `Slack API ${method} failed`);
    }
    return data;
}

/** Join a public channel so history read / postMessage work. No-op if already a member. */
export async function joinSlackChannel(token: string, channelId: string): Promise<void> {
    await slackApi<{ channel?: { id: string } }>(token, 'conversations.join', { channel: channelId });
}

export async function ensureSlackBotInChannel(token: string, channelId: string): Promise<void> {
    try {
        await joinSlackChannel(token, channelId);
    } catch (error: unknown) {
        if (error instanceof Error && error.message === 'already_in_channel') return;
        if (isSlackIgnorableJoinError(error)) return;
        throw error;
    }
}

export async function listSlackChannels(token: string): Promise<SlackChannelItem[]> {
    const channels: SlackChannelItem[] = [];
    let cursor: string | undefined;
    do {
        const data = await slackApi<{
            channels?: Array<{ id: string; name: string; is_private?: boolean }>;
            response_metadata?: { next_cursor?: string };
        }>(token, 'conversations.list', {
            types: 'public_channel,private_channel',
            exclude_archived: true,
            limit: 200,
            cursor,
        });
        for (const ch of data.channels ?? []) {
            channels.push({
                id: ch.id,
                name: ch.name,
                isPrivate: Boolean(ch.is_private),
            });
        }
        cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return channels.sort((a, b) => a.name.localeCompare(b.name));
}

type SlackHistoryMessage = {
    ts: string;
    user?: string;
    text?: string;
    bot_id?: string;
    subtype?: string;
    thread_ts?: string;
    reply_count?: number;
};

async function fetchSlackThreadReplies(
    token: string,
    channelId: string,
    parentTs: string,
): Promise<SlackHistoryMessage[]> {
    const out: SlackHistoryMessage[] = [];
    let cursor: string | undefined;
    let pages = 0;
    const maxPages = chatPluginHistoryMaxPages();

    do {
        const data = await slackApi<{
            messages?: SlackHistoryMessage[];
            response_metadata?: { next_cursor?: string };
        }>(token, 'conversations.replies', {
            channel: channelId,
            ts: parentTs,
            limit: SLACK_HISTORY_PAGE_LIMIT,
            ...(cursor ? { cursor } : {}),
        });
        for (const r of data.messages ?? []) {
            if (r.ts === parentTs) continue;
            out.push({ ...r, thread_ts: parentTs });
        }
        cursor = data.response_metadata?.next_cursor || undefined;
        pages += 1;
    } while (cursor && pages < maxPages);

    return out;
}

export async function fetchSlackChannelHistory(
    token: string,
    channelId: string,
    oldest?: string,
): Promise<SlackHistoryMessage[]> {
    await ensureSlackBotInChannel(token, channelId).catch((error: unknown) => {
        if (!isSlackIgnorableJoinError(error)) throw error;
    });

    const loadHistoryPage = (cursor?: string) =>
        slackApi<{
            messages?: SlackHistoryMessage[];
            response_metadata?: { next_cursor?: string };
        }>(token, 'conversations.history', {
            channel: channelId,
            limit: SLACK_HISTORY_PAGE_LIMIT,
            oldest,
            ...(cursor ? { cursor } : {}),
        });

    const allPages: SlackHistoryMessage[] = [];
    let cursor: string | undefined;
    let pages = 0;
    const maxPages = chatPluginHistoryMaxPages();
    let joined = false;

    do {
        let data: {
            messages?: SlackHistoryMessage[];
            response_metadata?: { next_cursor?: string };
        };
        try {
            data = await loadHistoryPage(cursor);
        } catch (error: unknown) {
            if (isSlackMissingScopeError(error)) throw error;
            if (!isSlackNotInChannelError(error)) throw error;
            if (!joined) {
                await ensureSlackBotInChannel(token, channelId);
                joined = true;
                data = await loadHistoryPage(cursor);
            } else {
                throw error;
            }
        }

        for (const m of data.messages ?? []) {
            allPages.push(m);
        }
        cursor = data.response_metadata?.next_cursor || undefined;
        pages += 1;
    } while (cursor && pages < maxPages);

    const out: SlackHistoryMessage[] = [];
    const seenTs = new Set<string>();
    for (const m of allPages) {
        if (seenTs.has(m.ts)) continue;
        seenTs.add(m.ts);
        out.push(m);
        if (m.thread_ts && m.thread_ts === m.ts && m.reply_count && m.reply_count > 0) {
            try {
                const replies = await fetchSlackThreadReplies(token, channelId, m.ts);
                for (const r of replies) {
                    if (r.ts === m.ts) continue;
                    if (seenTs.has(r.ts)) continue;
                    seenTs.add(r.ts);
                    out.push(r);
                }
            } catch {
                /* skip thread fetch errors */
            }
        }
    }
    return out;
}

export async function postSlackMessage(
    token: string,
    channelId: string,
    text: string,
    threadTs?: string,
    replyBroadcast = false,
): Promise<string> {
    await ensureSlackBotInChannel(token, channelId).catch((error: unknown) => {
        if (!isSlackIgnorableJoinError(error)) throw error;
    });

    const body: Record<string, unknown> = { channel: channelId, text };
    if (threadTs) {
        body.thread_ts = threadTs;
        if (replyBroadcast) body.reply_broadcast = true;
    }

    const post = () => slackApi<{ ts?: string }>(token, 'chat.postMessage', body);
    let data: { ts?: string };
    try {
        data = await post();
    } catch (error: unknown) {
        if (isSlackMissingScopeError(error)) throw error;
        if (!isSlackNotInChannelError(error)) throw error;
        await ensureSlackBotInChannel(token, channelId);
        data = await post();
    }
    if (!data.ts) throw new Error('Slack did not return message timestamp');
    return data.ts;
}

export async function fetchSlackUserEmail(token: string, slackUserId: string): Promise<string | null> {
    try {
        const data = await slackApi<{ user?: { profile?: { email?: string } } }>(token, 'users.info', {
            user: slackUserId,
        });
        const email = data.user?.profile?.email?.trim().toLowerCase();
        return email && email.includes('@') ? email : null;
    } catch {
        return null;
    }
}

/** Slack display name for mentions (users.info). */
export async function fetchSlackUserDisplayName(
    token: string,
    slackUserId: string,
): Promise<string | null> {
    try {
        const data = await slackApi<{
            user?: {
                real_name?: string;
                name?: string;
                profile?: { display_name?: string; real_name?: string };
            };
        }>(token, 'users.info', { user: slackUserId });
        const u = data.user;
        if (!u) return null;
        const p = u.profile;
        const fromProfile =
            p?.display_name?.trim() ||
            p?.real_name?.trim();
        const fromUser = u.real_name?.trim() || u.name?.trim();
        return fromProfile || fromUser || null;
    } catch {
        return null;
    }
}

export function verifySlackSignature(rawBody: string, timestamp: string, signature: string): boolean {
    const secret = process.env.SLACK_SIGNING_SECRET?.trim();
    if (!secret) return false;
    const fiveMinutes = 60 * 5;
    const ts = parseInt(timestamp, 10);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > fiveMinutes) return false;
    const base = `v0:${timestamp}:${rawBody}`;
    const expected = 'v0=' + crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex');
    try {
        const a = Buffer.from(expected, 'utf8');
        const b = Buffer.from(signature, 'utf8');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}
