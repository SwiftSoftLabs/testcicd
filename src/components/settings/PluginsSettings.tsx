'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { CalendarConferencingPluginsSettings } from '@/components/settings/CalendarConferencingPluginsSettings';
import { ChatPluginsSettings } from '@/components/settings/ChatPluginsSettings';
import { EmailPluginsSettings } from '@/components/settings/EmailPluginsSettings';
import { TaskPluginsSettings } from '@/components/settings/TaskPluginsSettings';
import { VercelPluginsSettings } from '@/components/settings/VercelPluginsSettings';
import { useAppContext } from '@/context/AppContext';
import {
    PluginIntegrationCard,
    PluginMetaItem,
    PluginSection,
    PluginsStatusLoading,
    pluginBtnPrimary,
    pluginBtnSecondary,
    type PluginConnectionStatus,
} from '@/components/settings/PluginIntegrationCard';
import { useUIContext } from '@/context/UIContext';
import { api, type CalendarPluginStatusResponse } from '@/lib/api';
import { getProviderCapabilities } from '@/lib/plugins/calendar/registry';
import type { CalendarPluginProvider } from '@/lib/plugins/calendar/types';
import { calendarPluginIconId, type PluginIconId } from '@/lib/plugins/plugin-icons';

const PLUGIN_OAUTH_MSG_SOURCE = 'onework-calendar-plugin-oauth';

type PluginOAuthPostMessage = {
    source?: string;
    status?: 'connected' | 'error';
    error?: string;
};

type PluginCardConfig = {
    provider: CalendarPluginProvider;
    apiProvider: 'google_calendar' | 'outlook' | 'calendly' | 'google';
    title: string;
    tagline: string;
    icon: PluginIconId;
    configuredKey: keyof Pick<CalendarPluginStatusResponse, 'googleConfigured' | 'outlookConfigured' | 'calendlyConfigured'>;
};

const PLUGIN_CARDS: PluginCardConfig[] = [
    {
        provider: 'google_calendar',
        apiProvider: 'google',
        title: 'Google Calendar',
        tagline: 'Two-way sync for Google Calendar events.',
        icon: calendarPluginIconId('google_calendar'),
        configuredKey: 'googleConfigured',
    },
    {
        provider: 'outlook',
        apiProvider: 'outlook',
        title: 'Microsoft Outlook',
        tagline: 'Two-way sync for Outlook calendar events.',
        icon: calendarPluginIconId('outlook'),
        configuredKey: 'outlookConfigured',
    },
    {
        provider: 'calendly',
        apiProvider: 'calendly',
        title: 'Calendly',
        tagline: 'Import bookings into OneWork; edits stay in Calendly.',
        icon: calendarPluginIconId('calendly'),
        configuredKey: 'calendlyConfigured',
    },
];

const PluginsSettings: React.FC = () => {
    const { addToast } = useUIContext();
    const { selectedWorkspaceId } = useAppContext();
    const router = useRouter();
    const searchParams = useSearchParams();

    const [pluginStatus, setPluginStatus] = useState<CalendarPluginStatusResponse | null>(null);
    const [isStatusLoading, setIsStatusLoading] = useState(true);
    const [loadingProvider, setLoadingProvider] = useState<CalendarPluginProvider | null>(null);
    const [syncingProvider, setSyncingProvider] = useState<CalendarPluginProvider | 'all' | null>(null);

    const refreshPluginStatus = useCallback(async () => {
        const status = await api.calendarPlugins.status();
        setPluginStatus(status);
        return status;
    }, []);

    useEffect(() => {
        setIsStatusLoading(true);
        void refreshPluginStatus()
            .catch(() => setPluginStatus(null))
            .finally(() => setIsStatusLoading(false));
    }, [refreshPluginStatus]);

    useEffect(() => {
        const oauth = searchParams.get('pluginOAuth');
        const chatOauth = searchParams.get('chatPluginOAuth');
        const taskOauth = searchParams.get('taskPluginOAuth');
        const error = searchParams.get('error');
        if (oauth === 'connected') {
            addToast('Calendar plugin connected.', 'success');
            void refreshPluginStatus();
            router.replace('/settings/plugins');
        } else if (chatOauth === 'connected') {
            const provider = searchParams.get('provider');
            const label =
                provider === 'teams'
                    ? 'Microsoft Teams'
                    : provider === 'discord'
                      ? 'Discord'
                      : 'Slack';
            addToast(`${label} connected.`, 'success');
            router.replace('/settings/plugins');
        } else if (taskOauth === 'connected') {
            const provider = searchParams.get('provider');
            const label =
                provider === 'jira'
                    ? 'Jira'
                    : provider === 'clickup'
                      ? 'ClickUp'
                      : provider === 'asana'
                        ? 'Asana'
                        : 'Trello';
            addToast(`${label} connected.`, 'success');
            router.replace('/settings/plugins');
        } else if (oauth === 'error' || chatOauth === 'error' || taskOauth === 'error') {
            addToast(error || 'Plugin connection failed', 'error');
            router.replace('/settings/plugins');
        }
    }, [addToast, refreshPluginStatus, router, searchParams]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data as PluginOAuthPostMessage;
            if (data?.source !== PLUGIN_OAUTH_MSG_SOURCE) return;
            if (data.status === 'connected') {
                addToast('Calendar plugin connected. Syncing…', 'success');
                void refreshPluginStatus().then(() => api.calendarPlugins.sync());
            } else if (data.status === 'error') {
                addToast(data.error || 'Calendar plugin connection failed', 'error');
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [addToast, refreshPluginStatus]);

    const startPluginOAuthPopup = (apiProvider: PluginCardConfig['apiProvider']) => {
        const returnTo = `${window.location.origin}/settings/plugins`;
        const url = api.calendarPlugins.startUrl(apiProvider, { returnTo, popup: true });
        const win = window.open(url, 'onework-calendar-plugin-oauth', 'width=520,height=720,scrollbars=yes,resizable=yes');
        if (!win) addToast('Allow pop-ups to connect this plugin.', 'warning');
    };

    const disconnectPlugin = async (provider: CalendarPluginProvider, apiProvider: PluginCardConfig['apiProvider']) => {
        setLoadingProvider(provider);
        try {
            await api.calendarPlugins.disconnect(apiProvider);
            await refreshPluginStatus();
            addToast('Plugin disconnected.', 'warning');
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Could not disconnect plugin', 'error');
        } finally {
            setLoadingProvider(null);
        }
    };

    const syncPlugin = async (provider?: CalendarPluginProvider) => {
        setSyncingProvider(provider ?? 'all');
        try {
            const result = await api.calendarPlugins.sync(provider);
            const errors = result.results.filter((r) => r.error);
            if (errors.length) {
                addToast(errors[0]?.error || 'Sync completed with errors', 'warning');
            } else {
                const pulled = result.results.reduce((sum, r) => sum + r.pulled, 0);
                addToast(`Sync complete. ${pulled} event(s) updated.`, 'success');
            }
            await refreshPluginStatus();
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Sync failed', 'error');
        } finally {
            setSyncingProvider(null);
        }
    };

    return (
        <div className="mx-auto max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <header>
                <h3 className="text-lg font-bold text-white">Plugins</h3>
                <p className="mt-1 text-sm text-text-secondary">
                    Connect email, calendars, chat, tasks, and deployment tools. Each plugin syncs into your workspace.
                </p>
            </header>

            <EmailPluginsSettings />

            <PluginSection title="Calendar" description="Keep events in sync with your schedule in OneWork.">
                {isStatusLoading ? (
                    <PluginsStatusLoading count={PLUGIN_CARDS.length} />
                ) : (
                PLUGIN_CARDS.map((card) => {
                    const integration = pluginStatus?.plugins.find((p) => p.provider === card.provider) ?? null;
                    const configured = Boolean(pluginStatus?.[card.configuredKey]);
                    const connected = integration?.connected ?? false;
                    const caps = getProviderCapabilities(card.provider);
                    const isLoading = loadingProvider === card.provider;
                    const isSyncing = syncingProvider === card.provider || syncingProvider === 'all';

                    const status: PluginConnectionStatus = connected
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
                            status={status}
                            meta={
                                connected && integration ? (
                                    <>
                                        {integration.accountEmail && (
                                            <PluginMetaItem label="Account">
                                                {integration.accountEmail}
                                            </PluginMetaItem>
                                        )}
                                        <PluginMetaItem label="Last sync">
                                            {integration.lastSyncedAt
                                                ? new Date(integration.lastSyncedAt).toLocaleString()
                                                : 'Never'}
                                        </PluginMetaItem>
                                    </>
                                ) : undefined
                            }
                            errorMessage={
                                connected && integration?.lastSyncError
                                    ? integration.lastSyncError
                                    : undefined
                            }
                            note={
                                connected && !caps.canCreateArbitraryEvents
                                    ? 'Inbound bookings only — create events in Calendly.'
                                    : undefined
                            }
                            actions={
                                connected ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => void syncPlugin(card.provider)}
                                            disabled={isSyncing || isLoading}
                                            className={pluginBtnPrimary}
                                        >
                                            {isSyncing ? 'Syncing…' : 'Sync now'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void disconnectPlugin(card.provider, card.apiProvider)}
                                            disabled={isLoading || isSyncing}
                                            className={pluginBtnSecondary}
                                        >
                                            Disconnect
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => startPluginOAuthPopup(card.apiProvider)}
                                        disabled={!configured || isLoading}
                                        className={pluginBtnPrimary}
                                    >
                                        Connect
                                    </button>
                                )
                            }
            />
                    );
                })
                )}
            </PluginSection>

            <CalendarConferencingPluginsSettings />

            <ChatPluginsSettings />

            <TaskPluginsSettings />

            {selectedWorkspaceId ? (
                <VercelPluginsSettings
                    workspaceId={selectedWorkspaceId}
                    addToast={addToast}
                />
            ) : null}
        </div>
    );
};

export default PluginsSettings;
