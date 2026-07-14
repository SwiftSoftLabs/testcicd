'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { useAppContext } from '@/context/AppContext';
import { useUIContext } from '@/context/UIContext';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';
import {
    PluginIntegrationCard,
    PluginMetaItem,
    PluginSection,
    PluginsStatusLoading,
    pluginBtnGhost,
    pluginBtnPrimary,
    pluginBtnSecondary,
    type PluginConnectionStatus,
} from '@/components/settings/PluginIntegrationCard';
import {
    api,
    type ChatPluginSlackStatus,
    type ConversationLinkDTO,
    type ExternalChannelItem,
} from '@/lib/api';
import { chatPluginIconId, type PluginIconId } from '@/lib/plugins/plugin-icons';

const CHAT_PLUGIN_OAUTH_MSG_SOURCE = 'onework-chat-plugin-oauth';

type ChatPluginProvider = 'slack' | 'teams' | 'discord';

type ChatPluginOAuthPostMessage = {
    source?: string;
    status?: 'connected' | 'error';
    error?: string;
    provider?: string;
};

type ProviderCard = {
    provider: ChatPluginProvider;
    title: string;
    icon: PluginIconId;
    tagline: string;
    webhookHint?: React.ReactNode;
};

const PROVIDER_CARDS: ProviderCard[] = [
    {
        provider: 'slack',
        title: 'Slack',
        icon: chatPluginIconId('slack'),
        tagline: 'Link channels for two-way message sync with Slack.',
        webhookHint: (
            <>
                Event Subscriptions URL:{' '}
                <code className="text-primary/90">/api/plugins/chat/webhooks/slack</code> with{' '}
                <code className="text-white/80">message.channels</code>
                {', message.groups'} for private channels.
            </>
        ),
    },
    {
        provider: 'teams',
        title: 'Microsoft Teams',
        icon: chatPluginIconId('teams'),
        tagline: 'Link channels; Teams updates via Graph webhooks and sync.',
        webhookHint: (
            <>
                Graph webhook URL:{' '}
                <code className="text-primary/90">/api/plugins/chat/webhooks/teams</code> (auto-registered per
                linked channel).
            </>
        ),
    },
    {
        provider: 'discord',
        title: 'Discord',
        icon: chatPluginIconId('discord'),
        tagline: 'Add the bot to your server, then link text channels.',
    },
];

function channelLabel(provider: ChatPluginProvider, ch: ExternalChannelItem): string {
    if (provider === 'teams' && ch.subtitle) {
        return `${ch.subtitle} / ${ch.name}`;
    }
    return `#${ch.name}${ch.isPrivate ? ' (private)' : ''}`;
}

function externalChannelDisplayName(
    provider: ChatPluginProvider,
    ch: ExternalChannelItem | undefined,
    externalChannelId: string,
): string | undefined {
    if (!ch) return undefined;
    if (provider === 'teams') return channelLabel(provider, ch);
    return `#${ch.name}`;
}

export function ChatPluginsSettings() {
    const { addToast } = useUIContext();
    const { selectedWorkspaceId } = useAppContext();
    const { can } = useWorkspacePermissions();
    const canManage = can('manage_bot_integrations');

    const [slackStatus, setSlackStatus] = useState<ChatPluginSlackStatus | null>(null);
    const [teamsStatus, setTeamsStatus] = useState<ChatPluginSlackStatus | null>(null);
    const [discordStatus, setDiscordStatus] = useState<ChatPluginSlackStatus | null>(null);
    const [slackConfigured, setSlackConfigured] = useState(false);
    const [teamsConfigured, setTeamsConfigured] = useState(false);
    const [discordConfigured, setDiscordConfigured] = useState(false);
    const [links, setLinks] = useState<ConversationLinkDTO[]>([]);
    const [channelsByProvider, setChannelsByProvider] = useState<
        Partial<Record<ChatPluginProvider, ExternalChannelItem[]>>
    >({});
    const [conversations, setConversations] = useState<Array<{ id: string; name: string }>>([]);
    const [isStatusLoading, setIsStatusLoading] = useState(true);
    const [loading, setLoading] = useState(false);
    const [syncingProvider, setSyncingProvider] = useState<ChatPluginProvider | null>(null);
    const [linkForm, setLinkForm] = useState<{
        provider: ChatPluginProvider;
        conversationId: string;
        externalChannelId: string;
    }>({ provider: 'slack', conversationId: '', externalChannelId: '' });

    const refresh = useCallback(async () => {
        if (!selectedWorkspaceId) {
            setIsStatusLoading(false);
            return;
        }
        const [statusRes, linksRes, convRes] = await Promise.all([
            api.chatPlugins.status(selectedWorkspaceId),
            api.chatPlugins.listLinks(selectedWorkspaceId),
            api.chat.getConversations(selectedWorkspaceId) as Promise<{
                data?: Array<{ id: string; name: string; type: string }>;
            }>,
        ]);
        setSlackConfigured(statusRes.slackConfigured);
        setTeamsConfigured(statusRes.teamsConfigured);
        setDiscordConfigured(statusRes.discordConfigured);
        setSlackStatus(statusRes.slack);
        setTeamsStatus(statusRes.teams);
        setDiscordStatus(statusRes.discord);
        setLinks(linksRes.links);
        const chans = (convRes?.data ?? [])
            .filter((c) => c.type === 'channel')
            .map((c) => ({ id: c.id, name: c.name || 'channel' }));
        setConversations(chans);

        const nextChannels: Partial<Record<ChatPluginProvider, ExternalChannelItem[]>> = {};
        for (const p of ['slack', 'teams', 'discord'] as const) {
            const connected =
                p === 'slack'
                    ? statusRes.slack.connected
                    : p === 'teams'
                      ? statusRes.teams.connected
                      : statusRes.discord.connected;
            if (!connected) continue;
            try {
                const ch = await api.chatPlugins.listChannels(selectedWorkspaceId, p);
                nextChannels[p] = ch.channels;
            } catch {
                nextChannels[p] = [];
            }
        }
        setChannelsByProvider(nextChannels);
    }, [selectedWorkspaceId]);

    useEffect(() => {
        setIsStatusLoading(true);
        void refresh()
            .catch(() => {
                setSlackStatus(null);
                setTeamsStatus(null);
                setDiscordStatus(null);
                setLinks([]);
            })
            .finally(() => setIsStatusLoading(false));
    }, [refresh]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data as ChatPluginOAuthPostMessage;
            if (data?.source !== CHAT_PLUGIN_OAUTH_MSG_SOURCE) return;
            const label =
                data.provider === 'teams'
                    ? 'Microsoft Teams'
                    : data.provider === 'discord'
                      ? 'Discord'
                      : 'Slack';
            if (data.status === 'connected') {
                addToast(`${label} connected.`, 'success');
                void refresh();
            } else if (data.status === 'error') {
                addToast(data.error || `${label} connection failed`, 'error');
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [addToast, refresh]);

    const statusFor = (provider: ChatPluginProvider) => {
        if (provider === 'slack') return slackStatus;
        if (provider === 'teams') return teamsStatus;
        return discordStatus;
    };

    const configuredFor = (provider: ChatPluginProvider) => {
        if (provider === 'slack') return slackConfigured;
        if (provider === 'teams') return teamsConfigured;
        return discordConfigured;
    };

    const startOAuth = (provider: ChatPluginProvider) => {
        if (!selectedWorkspaceId) return;
        const returnTo = `${window.location.origin}/settings/plugins`;
        const url = api.chatPlugins.startUrl(selectedWorkspaceId, provider, { returnTo, popup: true });
        const win = window.open(url, 'onework-chat-plugin-oauth', 'width=520,height=720,scrollbars=yes,resizable=yes');
        if (!win) addToast('Allow pop-ups to connect.', 'warning');
    };

    const disconnect = async (provider: ChatPluginProvider) => {
        if (!selectedWorkspaceId) return;
        setLoading(true);
        try {
            await api.chatPlugins.disconnect(selectedWorkspaceId, provider);
            const label =
                provider === 'teams' ? 'Teams' : provider === 'discord' ? 'Discord' : 'Slack';
            addToast(`${label} disconnected.`, 'warning');
            await refresh();
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Disconnect failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    const syncProvider = async (provider: ChatPluginProvider) => {
        if (!selectedWorkspaceId) return;
        setSyncingProvider(provider);
        try {
            const result = await api.chatPlugins.sync(selectedWorkspaceId, provider);
            if (result.error) {
                addToast(result.error, 'warning');
            } else {
                addToast(`Sync complete. ${result.imported} message(s) imported.`, 'success');
            }
            await refresh();
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Sync failed', 'error');
        } finally {
            setSyncingProvider(null);
        }
    };

    const createLink = async (provider: ChatPluginProvider) => {
        if (!selectedWorkspaceId || !linkForm.conversationId || !linkForm.externalChannelId) return;
        if (linkForm.provider !== provider) return;
        const channel = channelsByProvider[provider]?.find((c) => c.id === linkForm.externalChannelId);
        setLoading(true);
        try {
            const result = await api.chatPlugins.createLink({
                workspaceId: selectedWorkspaceId,
                provider,
                conversationId: linkForm.conversationId,
                externalChannelId: linkForm.externalChannelId,
                externalChannelName: externalChannelDisplayName(provider, channel, linkForm.externalChannelId),
            });
            if (result.warning) {
                addToast(result.warning, 'warning');
            } else if (result.alreadyLinked) {
                addToast(
                    `Already linked. ${result.imported} message(s) imported on sync.`,
                    result.imported > 0 ? 'success' : 'info',
                );
            } else {
                addToast(`Channel linked. ${result.imported} message(s) imported.`, 'success');
            }
            setLinkForm({ provider, conversationId: '', externalChannelId: '' });
            await refresh();
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Link failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    const removeLink = async (linkId: string) => {
        if (!selectedWorkspaceId) return;
        setLoading(true);
        try {
            await api.chatPlugins.deleteLink(selectedWorkspaceId, linkId);
            addToast('Channel unlinked.', 'info');
            await refresh();
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Unlink failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    if (!selectedWorkspaceId) {
        return <p className="text-sm text-text-secondary">Select a workspace to manage chat plugins.</p>;
    }

    if (!canManage) {
        return (
            <p className="text-sm text-text-secondary">
                You need the Manage Bot Integrations permission to configure chat plugins.
            </p>
        );
    }

    return (
        <PluginSection
            title="Chat"
            description="Mirror Slack, Teams, or Discord channels into OneWork conversations."
        >
            {isStatusLoading ? (
                <PluginsStatusLoading count={PROVIDER_CARDS.length} />
            ) : (
            PROVIDER_CARDS.map((card) => {
                const status = statusFor(card.provider);
                const connected = status?.connected ?? false;
                const configured = configuredFor(card.provider);
                const providerLinks = links.filter((l) => l.provider === card.provider);
                const channels = channelsByProvider[card.provider] ?? [];
                const isSyncing = syncingProvider === card.provider;

                const connectionStatus: PluginConnectionStatus = connected
                    ? 'connected'
                    : configured
                      ? 'disconnected'
                      : 'not_configured';

                return (
                    <PluginIntegrationCard
                        key={card.provider}
                        icon={card.icon}
                        title={card.title}
                        tagline={card.tagline}
                        status={connectionStatus}
                        meta={
                            connected && status ? (
                                <>
                                    {status.teamName && (
                                        <PluginMetaItem label="Workspace">
                                            {status.teamName}
                                        </PluginMetaItem>
                                    )}
                                    <PluginMetaItem label="Last sync">
                                        {status.lastSyncedAt
                                            ? new Date(status.lastSyncedAt).toLocaleString()
                                            : 'Never'}
                                    </PluginMetaItem>
                                    {providerLinks.length > 0 && (
                                        <PluginMetaItem label="Links">
                                            {providerLinks.length} channel
                                            {providerLinks.length === 1 ? '' : 's'}
                                        </PluginMetaItem>
                                    )}
                                </>
                            ) : undefined
                        }
                        errorMessage={
                            connected && status?.lastSyncError ? status.lastSyncError : undefined
                        }
                        actions={
                            connected ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => void syncProvider(card.provider)}
                                        disabled={isSyncing || loading}
                                        className={pluginBtnPrimary}
                                    >
                                        {isSyncing ? 'Syncing…' : 'Sync now'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void disconnect(card.provider)}
                                        disabled={loading || isSyncing}
                                        className={pluginBtnSecondary}
                                    >
                                        Disconnect
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => startOAuth(card.provider)}
                                    disabled={!configured || loading}
                                    className={pluginBtnPrimary}
                                >
                                    Connect
                                </button>
                            )
                        }
                        footer={
                            connected ? (
                                <div className="cursor-pointer space-y-3">
                                    {providerLinks.length > 0 && (
                                        <ul className="divide-y divide-border-dark/80 rounded-lg border border-border-dark overflow-hidden">
                                            {providerLinks.map((link) => (
                                                <li
                                                    key={link.id}
                                                    className="flex items-center justify-between gap-3 bg-background-dark/30 px-3 py-2 text-xs"
                                                >
                                                    <span className="min-w-0 truncate text-text-secondary">
                                                        <span className="font-medium text-white">
                                                            #{link.conversationName ?? 'channel'}
                                                        </span>
                                                        <span className="mx-1.5 text-text-secondary/50">↔</span>
                                                        {link.externalChannelName ?? link.externalChannelId}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => void removeLink(link.id)}
                                                        className="shrink-0 font-medium text-amber-400 hover:text-amber-300"
                                                    >
                                                        Unlink
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                                        <label className="block min-w-0">
                                            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-text-secondary/80">
                                                OneWork channel
                                            </span>
                                            <select
                                                value={
                                                    linkForm.provider === card.provider
                                                        ? linkForm.conversationId
                                                        : ''
                                                }
                                                onChange={(e) =>
                                                    setLinkForm({
                                                        provider: card.provider,
                                                        conversationId: e.target.value,
                                                        externalChannelId: '',
                                                    })
                                                }
                                                className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-xs text-white"
                                            >
                                                <option value="">Select…</option>
                                                {conversations
                                                    .filter(
                                                        (c) =>
                                                            !links.some(
                                                                (l) =>
                                                                    l.conversationId === c.id &&
                                                                    l.provider === card.provider,
                                                            ),
                                                    )
                                                    .map((c) => (
                                                        <option key={c.id} value={c.id}>
                                                            #{c.name}
                                                        </option>
                                                    ))}
                                            </select>
                                        </label>
                                        <label className="block min-w-0">
                                            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-text-secondary/80">
                                                {card.title} channel
                                            </span>
                                            <select
                                                value={
                                                    linkForm.provider === card.provider
                                                        ? linkForm.externalChannelId
                                                        : ''
                                                }
                                                onChange={(e) =>
                                                    setLinkForm((f) => ({
                                                        ...f,
                                                        provider: card.provider,
                                                        externalChannelId: e.target.value,
                                                    }))
                                                }
                                                disabled={
                                                    !linkForm.conversationId ||
                                                    linkForm.provider !== card.provider
                                                }
                                                className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-xs text-white disabled:opacity-50"
                                            >
                                                <option value="">Select…</option>
                                                {channels.map((c) => (
                                                    <option key={c.id} value={c.id}>
                                                        {channelLabel(card.provider, c)}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => void createLink(card.provider)}
                                            disabled={
                                                loading ||
                                                linkForm.provider !== card.provider ||
                                                !linkForm.conversationId ||
                                                !linkForm.externalChannelId
                                            }
                                            className={`${pluginBtnGhost} lg:mb-0`}
                                        >
                                            Link
                                        </button>
                                    </div>
                                    {card.webhookHint && (
                                        <p className="text-[11px] leading-relaxed text-text-secondary/75">
                                            {card.webhookHint}
                                        </p>
                                    )}
                                </div>
                            ) : undefined
                        }
                    />
                );
            })
            )}
        </PluginSection>
    );
}
