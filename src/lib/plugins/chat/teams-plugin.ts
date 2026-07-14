import { query, SCHEMA } from '@/lib/db';

import type { ChatPluginProviderHandler } from './provider';
import type { ChatPluginInstallationRow, ExternalChatMessage } from './types';
import {
    fetchTeamsChannelHistory,
    fetchTeamsUserEmail,
    listTeamsChannels,
    postTeamsMessage,
} from './teams';

export const teamsChatPlugin: ChatPluginProviderHandler = {
    provider: 'teams',

    listChannels(_installation, accessToken) {
        return listTeamsChannels(accessToken);
    },

    fetchChannelHistory(accessToken, externalChannelId, since) {
        return fetchTeamsChannelHistory(accessToken, externalChannelId, since);
    },

    postMessage(accessToken, externalChannelId, text, options) {
        return postTeamsMessage(
            accessToken,
            externalChannelId,
            text,
            options?.threadParentExternalId,
        );
    },

    async resolveSender(installation, accessToken, message) {
        const senderId = message.senderExternalId;
        if (senderId) {
            const email = await fetchTeamsUserEmail(accessToken, senderId);
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
                        displayName: member.rows[0].full_name,
                    };
                }
            }
        }
        return { userId: installation.installed_by, displayName: 'Teams user' };
    },

    shouldSkipInbound(installation, message) {
        return Boolean(
            message.senderExternalId &&
                installation.bot_user_id &&
                message.senderExternalId === installation.bot_user_id,
        );
    },
};
