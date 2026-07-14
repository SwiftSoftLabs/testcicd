import { query, SCHEMA } from '@/lib/db';

import type { ChatPluginProviderHandler } from './provider';
import type { ChatPluginInstallationRow, ExternalChatMessage } from './types';
import {
    fetchSlackChannelHistory,
    fetchSlackUserDisplayName,
    fetchSlackUserEmail,
    listSlackChannels,
    postSlackMessage,
} from './slack';

async function resolveSlackSenderId(
    installation: ChatPluginInstallationRow,
    slackUserId: string,
    token: string,
): Promise<{ userId: string; displayName: string | null }> {
    const email = await fetchSlackUserEmail(token, slackUserId);
    const slackName = await fetchSlackUserDisplayName(token, slackUserId);

    if (email) {
        const member = await query<{ user_id: string; full_name: string | null }>(
            `SELECT wm.user_id, p.full_name
             FROM ${SCHEMA}.workspace_members wm
             JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
             WHERE wm.workspace_id = $1 AND LOWER(p.email) = $2
             LIMIT 1`,
            [installation.workspace_id, email],
        );
        if (member.rows[0]) {
            return {
                userId: member.rows[0].user_id,
                displayName: member.rows[0].full_name ?? slackName,
            };
        }
    }
    return {
        userId: installation.installed_by,
        displayName: slackName ?? 'Slack user',
    };
}

export const slackChatPlugin: ChatPluginProviderHandler = {
    provider: 'slack',

    listChannels(_installation, accessToken) {
        return listSlackChannels(accessToken);
    },

    async fetchChannelHistory(accessToken, externalChannelId, since) {
        const raw = await fetchSlackChannelHistory(accessToken, externalChannelId, since);
        return raw
            .filter((m) => m.text?.trim() && m.subtype !== 'message_deleted')
            .map(
                (m): ExternalChatMessage => ({
                    externalId: m.ts,
                    text: m.text ?? '',
                    senderExternalId: m.user,
                    botId: m.bot_id,
                    threadParentExternalId:
                        m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : undefined,
                }),
            );
    },

    postMessage(accessToken, externalChannelId, text, options) {
        return postSlackMessage(
            accessToken,
            externalChannelId,
            text,
            options?.threadParentExternalId,
            options?.alsoSendToChannel,
        );
    },

    resolveSender(installation, accessToken, message) {
        if (!message.senderExternalId) {
            return Promise.resolve({
                userId: installation.installed_by,
                displayName: 'Slack user',
            });
        }
        return resolveSlackSenderId(installation, message.senderExternalId, accessToken);
    },

    shouldSkipInbound(installation, message) {
        return Boolean(
            message.botId &&
                installation.bot_user_id &&
                message.botId === installation.bot_user_id,
        );
    },
};
