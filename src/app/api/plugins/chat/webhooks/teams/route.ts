import { NextResponse } from 'next/server';

import { ingestPluginMessage } from '@/lib/plugins/chat/ingest';
import {
    findChatPluginInstallationById,
    findConversationLinkByExternalChannel,
} from '@/lib/plugins/chat/repository';
import { verifyTeamsWebhookClientState } from '@/lib/plugins/chat/teams-subscriptions';
import { fetchTeamsMessageByResource, formatTeamsChannelRef } from '@/lib/plugins/chat/teams';
import { validChatPluginAccessToken } from '@/lib/plugins/chat/tokens';
import { query, SCHEMA } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    const validationToken = request.headers.get('validation-token');
    if (validationToken) {
        return new NextResponse(validationToken, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
        });
    }

    let body: {
        value?: Array<{
            clientState?: string;
            resource?: string;
            subscriptionId?: string;
            changeType?: string;
        }>;
    };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    for (const notification of body.value ?? []) {
        if (notification.changeType !== 'created' || !notification.resource) continue;

        const subResult = await query<{ installation_id: string }>(
            `SELECT i.id AS installation_id
             FROM ${SCHEMA}.chat_plugin_installations i
             WHERE i.provider = 'teams'
               AND i.status = 'connected'
               AND i.settings->'subscriptions' IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM jsonb_each(i.settings->'subscriptions') sub
                 WHERE (sub.value->>'id') = $1
               )
             LIMIT 1`,
            [notification.subscriptionId ?? ''],
        );
        const installationId = subResult.rows[0]?.installation_id;
        if (!installationId) continue;

        const installation = await findChatPluginInstallationById(installationId);
        if (!installation || !verifyTeamsWebhookClientState(installation, notification.clientState)) {
            continue;
        }

        const resource = notification.resource;
        const channelMatch = resource.match(/teams\('([^']+)'\)\/channels\('([^']+)'\)/i)
            ?? resource.match(/\/teams\/([^/]+)\/channels\/([^/]+)/i);
        if (!channelMatch) continue;

        const externalChannelId = formatTeamsChannelRef(channelMatch[1], channelMatch[2]);
        const link = await findConversationLinkByExternalChannel(installation.id, externalChannelId);
        if (!link) continue;

        try {
            const token = await validChatPluginAccessToken(installation);
            const msgMatch = resource.match(
                /teams\('([^']+)'\)\/channels\('([^']+)'\)\/messages\('([^']+)'\)/i,
            ) ?? resource.match(/\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)/i);
            const graphPath = msgMatch
                ? `/teams/${msgMatch[1]}/channels/${msgMatch[2]}/messages/${msgMatch[3]}`
                : resource.startsWith('/')
                  ? resource
                  : `/${resource}`;
            const message = await fetchTeamsMessageByResource(token, graphPath);
            if (message) {
                await ingestPluginMessage(installation, link, message);
            }
        } catch (err) {
            console.error('[teams webhook]', err);
        }
    }

    return NextResponse.json({ ok: true });
}
