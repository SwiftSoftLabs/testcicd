import { query, SCHEMA } from '@/lib/db';

import { ingestPluginMessage } from './ingest';
import { getChatPluginHandler } from './registry';
import {
    createPluginMessageLink,
    findChatPluginInstallation,
    findChatPluginInstallationById,
    findConversationLinkByExternalChannel,
    findPluginMessageLinkByMessageId,
    listConversationLinksForInstallation,
    updateInstallationSyncState,
} from './repository';
import { ensureSlackBotInChannel, formatSlackErrorForUser } from './slack';
import { ensureTeamsChannelSubscription } from './teams-subscriptions';
import { chatPluginHistoryOldestUnix } from './history-config';
import { validChatPluginAccessToken } from './tokens';
import type { ChatPluginInstallationRow, ChatPluginProvider } from './types';

export async function syncChannelHistory(
    installation: ChatPluginInstallationRow,
    externalChannelId: string,
    conversationId: string,
): Promise<number> {
    const link = await findConversationLinkByExternalChannel(installation.id, externalChannelId);
    if (!link || link.conversation_id !== conversationId) return 0;

    const handler = getChatPluginHandler(installation.provider);
    const token = await validChatPluginAccessToken(installation);
    const since = chatPluginHistoryOldestUnix();
    const messages = await handler.fetchChannelHistory(token, externalChannelId, since);
    const sorted = [...messages].sort(
        (a, b) => parseFloat(a.externalId) - parseFloat(b.externalId),
    );
    let imported = 0;
    const slackMentionCache = installation.provider === 'slack' ? new Map<string, string>() : undefined;
    for (const msg of sorted) {
        if (await ingestPluginMessage(installation, link, msg, slackMentionCache)) imported += 1;
    }
    return imported;
}

export async function syncChatPluginInstallation(
    installation: ChatPluginInstallationRow,
): Promise<{ workspaceId: string; provider: string; imported: number; error?: string }> {
    try {
        const links = await listConversationLinksForInstallation(installation.id);
        let imported = 0;
        let lastLinkError: string | undefined;
        for (const link of links) {
            try {
                imported += await syncChannelHistory(
                    installation,
                    link.external_channel_id,
                    link.conversation_id,
                );
            } catch (linkError: unknown) {
                const msg =
                    installation.provider === 'slack'
                        ? formatSlackErrorForUser(linkError)
                        : linkError instanceof Error
                          ? linkError.message
                          : 'Channel sync failed';
                lastLinkError = msg;
            }
        }
        if (lastLinkError && imported === 0) {
            throw new Error(lastLinkError);
        }
        await updateInstallationSyncState(installation.id, {
            lastSyncedAt: new Date(),
            lastSyncError: lastLinkError ?? null,
        });
        return {
            workspaceId: installation.workspace_id,
            provider: installation.provider,
            imported,
            error: lastLinkError,
        };
    } catch (error: unknown) {
        const message =
            installation.provider === 'slack'
                ? formatSlackErrorForUser(error)
                : error instanceof Error
                  ? error.message
                  : 'Sync failed';
        await updateInstallationSyncState(installation.id, { lastSyncError: message });
        return {
            workspaceId: installation.workspace_id,
            provider: installation.provider,
            imported: 0,
            error: message,
        };
    }
}

export async function syncAllLinkedChannels(
    workspaceId: string,
    provider?: ChatPluginProvider,
): Promise<{ imported: number; error?: string }> {
    const providers: ChatPluginProvider[] = provider ? [provider] : ['slack', 'teams', 'discord'];
    let imported = 0;
    let lastError: string | undefined;

    for (const p of providers) {
        const installation = await findChatPluginInstallation(workspaceId, p);
        if (!installation) continue;
        const result = await syncChatPluginInstallation(installation);
        imported += result.imported;
        if (result.error) lastError = result.error;
    }

    if (!provider) {
        const anyConnected = await Promise.all(
            providers.map((p) => findChatPluginInstallation(workspaceId, p)),
        );
        if (!anyConnected.some(Boolean)) {
            throw new Error('No chat plugins connected for this workspace');
        }
    } else if (!await findChatPluginInstallation(workspaceId, provider)) {
        throw new Error(`${provider} is not connected for this workspace`);
    }

    return { imported, error: lastError };
}

/** @deprecated Use syncAllLinkedChannels */
export const syncAllLinkedSlackChannels = syncAllLinkedChannels;

export async function pushMessageIfLinked(
    conversationId: string,
    messageId: string,
    content: string,
): Promise<void> {
    const linkRow = await query<{
        installation_id: string;
        external_channel_id: string;
        provider: ChatPluginProvider;
        thread_root_message_id: string | null;
        also_sent_to_channel: boolean;
    }>(
        `SELECT l.installation_id, l.external_channel_id, i.provider,
                m.thread_root_message_id, m.also_sent_to_channel
         FROM ${SCHEMA}.plugin_conversation_links l
         JOIN ${SCHEMA}.chat_plugin_installations i ON i.id = l.installation_id
         JOIN ${SCHEMA}.messages m ON m.id = $2
         WHERE l.conversation_id = $1 AND i.status = 'connected'
         LIMIT 1`,
        [conversationId, messageId],
    );
    const row = linkRow.rows[0];
    if (!row) return;

    const installation = await findChatPluginInstallationById(row.installation_id);
    if (!installation) return;

    let threadParentExternalId: string | undefined;
    const threadRootId = row.thread_root_message_id;
    if (threadRootId) {
        const parentLink = await findPluginMessageLinkByMessageId(
            installation.id,
            threadRootId,
        );
        threadParentExternalId = parentLink?.external_message_id;
    }

    const handler = getChatPluginHandler(installation.provider);
    const token = await validChatPluginAccessToken(installation);
    const externalId = await handler.postMessage(token, row.external_channel_id, content.trim(), {
        threadParentExternalId,
        alsoSendToChannel: row.also_sent_to_channel,
    });
    await createPluginMessageLink({
        installationId: installation.id,
        messageId,
        externalMessageId: externalId,
        syncOrigin: 'export',
    });
}

export async function onConversationLinkCreated(
    installation: ChatPluginInstallationRow,
    externalChannelId: string,
): Promise<void> {
    if (installation.provider === 'teams') {
        await ensureTeamsChannelSubscription(installation, externalChannelId);
        return;
    }
    if (installation.provider === 'slack') {
        const token = await validChatPluginAccessToken(installation);
        try {
            await ensureSlackBotInChannel(token, externalChannelId);
        } catch {
            /* private channels require /invite — handled when syncing */
        }
    }
}

/** @deprecated Use pushMessageIfLinked */
export const pushMessageToSlackIfLinked = pushMessageIfLinked;
