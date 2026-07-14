import crypto from 'crypto';

import { getAppOrigin } from './oauth';
import {
    mergeInstallationSettings,
    findChatPluginInstallationById,
} from './repository';
import { validChatPluginAccessToken } from './tokens';
import type { ChatPluginInstallationRow } from './types';
import { parseTeamsChannelRef } from './teams';

const GRAPH = 'https://graph.microsoft.com/v1.0';

type SubscriptionEntry = { id: string; expiresAt: string };

function webhookClientState(installation: ChatPluginInstallationRow): string {
    const existing = installation.settings?.webhookClientState;
    if (typeof existing === 'string' && existing.length >= 16) return existing;
    return crypto.randomBytes(24).toString('hex');
}

function subscriptionsMap(installation: ChatPluginInstallationRow): Record<string, SubscriptionEntry> {
    const raw = installation.settings?.subscriptions;
    if (!raw || typeof raw !== 'object') return {};
    return raw as Record<string, SubscriptionEntry>;
}

function maxExpiration(): string {
    return new Date(Date.now() + 55 * 60 * 1000).toISOString();
}

async function graphSubscription(
    accessToken: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const res = await fetch(`${GRAPH}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (method === 'DELETE' && res.status === 204) return {};
    const data = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
    if (!res.ok) {
        throw new Error((data.error as { message?: string })?.message || 'Graph subscription failed');
    }
    return data;
}

export async function ensureTeamsChannelSubscription(
    installation: ChatPluginInstallationRow,
    externalChannelId: string,
): Promise<void> {
    const { teamId, channelId } = parseTeamsChannelRef(externalChannelId);
    const token = await validChatPluginAccessToken(installation);
    const clientState = webhookClientState(installation);
    const notificationUrl = `${getAppOrigin()}/api/plugins/chat/webhooks/teams`;
    const resource = `/teams/${teamId}/channels/${channelId}/messages`;
    const subs = subscriptionsMap(installation);
    const existing = subs[externalChannelId];
    const expiresSoon =
        existing?.expiresAt && new Date(existing.expiresAt).getTime() < Date.now() + 15 * 60 * 1000;

    let subId = existing?.id;
    let expiresAt = existing?.expiresAt;

    if (subId && expiresSoon) {
        await graphSubscription(token, 'PATCH', `/subscriptions/${subId}`, {
            expirationDateTime: maxExpiration(),
        });
        expiresAt = maxExpiration();
    } else if (!subId) {
        const created = await graphSubscription(token, 'POST', '/subscriptions', {
            changeType: 'created',
            notificationUrl,
            resource,
            expirationDateTime: maxExpiration(),
            clientState,
        });
        subId = String(created.id ?? '');
        expiresAt = String(created.expirationDateTime ?? maxExpiration());
    }

    if (!subId) return;

    await mergeInstallationSettings(installation.id, {
        webhookClientState: clientState,
        subscriptions: {
            ...subs,
            [externalChannelId]: { id: subId, expiresAt: expiresAt ?? maxExpiration() },
        },
    });
}

export async function renewTeamsSubscriptions(
    installation: ChatPluginInstallationRow,
): Promise<void> {
    const fresh = await findChatPluginInstallationById(installation.id);
    if (!fresh) return;
    const subs = subscriptionsMap(fresh);
    const token = await validChatPluginAccessToken(fresh);
    const next: Record<string, SubscriptionEntry> = { ...subs };

    for (const [channelRef, entry] of Object.entries(subs)) {
        const expires = new Date(entry.expiresAt).getTime();
        if (expires > Date.now() + 30 * 60 * 1000) continue;
        try {
            await graphSubscription(token, 'PATCH', `/subscriptions/${entry.id}`, {
                expirationDateTime: maxExpiration(),
            });
            next[channelRef] = { id: entry.id, expiresAt: maxExpiration() };
        } catch {
            try {
                await ensureTeamsChannelSubscription(fresh, channelRef);
            } catch {
                /* channel subscription may fail if link removed */
            }
        }
    }

    await mergeInstallationSettings(fresh.id, { subscriptions: next });
}

export function verifyTeamsWebhookClientState(
    installation: ChatPluginInstallationRow,
    clientState: string | undefined,
): boolean {
    const expected = installation.settings?.webhookClientState;
    if (typeof expected !== 'string' || !clientState) return false;
    try {
        const a = Buffer.from(expected, 'utf8');
        const b = Buffer.from(clientState, 'utf8');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}
