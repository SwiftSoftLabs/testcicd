'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { useAppContext } from '@/context/AppContext';
import { useUIContext } from '@/context/UIContext';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';
import {
    api,
    type ExternalTaskContainerItem,
    type ProjectLinkDTO,
    type TaskPluginProviderId,
    type TaskPluginStatusItem,
} from '@/lib/api';
import type { Project } from '@/types';
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
import { taskPluginIconId, type PluginIconId } from '@/lib/plugins/plugin-icons';

const TASK_PLUGIN_OAUTH_MSG_SOURCE = 'onework-task-plugin-oauth';

type TaskPluginOAuthPostMessage = {
    source?: string;
    status?: 'connected' | 'error';
    error?: string;
    provider?: string;
};

type ProviderCard = {
    provider: TaskPluginProviderId;
    title: string;
    icon: PluginIconId;
    tagline: string;
};

const PROVIDER_CARDS: ProviderCard[] = [
    {
        provider: 'trello',
        title: 'Trello',
        icon: taskPluginIconId('trello'),
        tagline: 'Import open cards from a linked Trello board.',
    },
    {
        provider: 'jira',
        title: 'Jira',
        icon: taskPluginIconId('jira'),
        tagline: 'Sync Jira issues; title and description push back.',
    },
    {
        provider: 'clickup',
        title: 'ClickUp',
        icon: taskPluginIconId('clickup'),
        tagline: 'Sync tasks from a ClickUp list on connect and cron.',
    },
    {
        provider: 'asana',
        title: 'Asana',
        icon: taskPluginIconId('asana'),
        tagline: 'Import incomplete Asana tasks; status updates push back.',
    },
];

function containerLabel(ch: ExternalTaskContainerItem): string {
    return ch.subtitle ? `${ch.subtitle} / ${ch.name}` : ch.name;
}

export function TaskPluginsSettings() {
    const { addToast } = useUIContext();
    const { selectedWorkspaceId, fetchTasks } = useAppContext();
    const { can } = useWorkspacePermissions();
    const canManage = can('manage_workflows');

    const [trelloStatus, setTrelloStatus] = useState<TaskPluginStatusItem | null>(null);
    const [jiraStatus, setJiraStatus] = useState<TaskPluginStatusItem | null>(null);
    const [clickupStatus, setClickupStatus] = useState<TaskPluginStatusItem | null>(null);
    const [asanaStatus, setAsanaStatus] = useState<TaskPluginStatusItem | null>(null);
    const [trelloConfigured, setTrelloConfigured] = useState(false);
    const [jiraConfigured, setJiraConfigured] = useState(false);
    const [clickupConfigured, setClickupConfigured] = useState(false);
    const [asanaConfigured, setAsanaConfigured] = useState(false);
    const [links, setLinks] = useState<ProjectLinkDTO[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [containersByProvider, setContainersByProvider] = useState<
        Partial<Record<TaskPluginProviderId, ExternalTaskContainerItem[]>>
    >({});
    const [isStatusLoading, setIsStatusLoading] = useState(true);
    const [loading, setLoading] = useState(false);
    const [syncingProvider, setSyncingProvider] = useState<TaskPluginProviderId | null>(null);
    const [linkForm, setLinkForm] = useState<{
        provider: TaskPluginProviderId;
        projectId: string;
        externalContainerId: string;
    }>({ provider: 'trello', projectId: '', externalContainerId: '' });

    const statusFor = (provider: TaskPluginProviderId): TaskPluginStatusItem | null => {
        if (provider === 'trello') return trelloStatus;
        if (provider === 'jira') return jiraStatus;
        if (provider === 'clickup') return clickupStatus;
        return asanaStatus;
    };

    const configuredFor = (provider: TaskPluginProviderId): boolean => {
        if (provider === 'trello') return trelloConfigured;
        if (provider === 'jira') return jiraConfigured;
        if (provider === 'clickup') return clickupConfigured;
        return asanaConfigured;
    };

    const refresh = useCallback(async () => {
        if (!selectedWorkspaceId) {
            setIsStatusLoading(false);
            return;
        }
        const [statusRes, linksRes, projectsRes] = await Promise.all([
            api.taskPlugins.status(selectedWorkspaceId),
            api.taskPlugins.listLinks(selectedWorkspaceId),
            api.projects.getAll(selectedWorkspaceId),
        ]);
        setTrelloConfigured(statusRes.trelloConfigured);
        setJiraConfigured(statusRes.jiraConfigured);
        setClickupConfigured(statusRes.clickupConfigured);
        setAsanaConfigured(statusRes.asanaConfigured);
        setTrelloStatus(statusRes.trello);
        setJiraStatus(statusRes.jira);
        setClickupStatus(statusRes.clickup);
        setAsanaStatus(statusRes.asana);
        setLinks(linksRes.links);
        setProjects(Array.isArray(projectsRes) ? projectsRes : []);

        const statusByProvider: Record<TaskPluginProviderId, TaskPluginStatusItem> = {
            trello: statusRes.trello,
            jira: statusRes.jira,
            clickup: statusRes.clickup,
            asana: statusRes.asana,
        };
        const connectedProviders = PROVIDER_CARDS.filter(
            (c) => statusByProvider[c.provider]?.connected,
        ).map((c) => c.provider);

        const containerEntries = await Promise.all(
            connectedProviders.map(async (provider) => {
                try {
                    const res = await api.taskPlugins.listContainers(selectedWorkspaceId, provider);
                    return [provider, res.containers] as const;
                } catch {
                    return [provider, []] as const;
                }
            }),
        );
        setContainersByProvider(Object.fromEntries(containerEntries));
    }, [selectedWorkspaceId]);

    useEffect(() => {
        setIsStatusLoading(true);
        void refresh().catch(() => undefined).finally(() => setIsStatusLoading(false));
    }, [refresh]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data as TaskPluginOAuthPostMessage;
            if (data?.source !== TASK_PLUGIN_OAUTH_MSG_SOURCE) return;
            const label =
                data.provider === 'jira'
                    ? 'Jira'
                    : data.provider === 'clickup'
                      ? 'ClickUp'
                      : data.provider === 'asana'
                        ? 'Asana'
                        : 'Trello';
            if (data.status === 'connected') {
                addToast(`${label} connected. Syncing…`, 'success');
                void refresh().then(() => {
                    if (!selectedWorkspaceId) return;
                    return api.taskPlugins.sync(selectedWorkspaceId, data.provider as TaskPluginProviderId);
                }).then((r) => {
                    if (r) {
                        addToast(
                            `Initial sync: ${r.imported} imported, ${r.updated} updated.`,
                            r.error ? 'warning' : 'success',
                        );
                        void fetchTasks();
                    }
                });
            } else if (data.status === 'error') {
                addToast(data.error || `${label} connection failed`, 'error');
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [addToast, fetchTasks, refresh, selectedWorkspaceId]);

    const startOAuth = (provider: TaskPluginProviderId) => {
        if (!selectedWorkspaceId) return;
        const returnTo = `${window.location.origin}/settings/plugins`;
        const url = api.taskPlugins.startUrl(selectedWorkspaceId, provider, { returnTo, popup: true });
        const win = window.open(url, 'onework-task-plugin-oauth', 'width=520,height=720,scrollbars=yes,resizable=yes');
        if (!win) addToast('Allow pop-ups to connect this plugin.', 'warning');
    };

    const disconnect = async (provider: TaskPluginProviderId) => {
        if (!selectedWorkspaceId) return;
        setLoading(true);
        try {
            await api.taskPlugins.disconnect(selectedWorkspaceId, provider);
            const label =
                provider === 'jira'
                    ? 'Jira'
                    : provider === 'clickup'
                      ? 'ClickUp'
                      : provider === 'asana'
                        ? 'Asana'
                        : 'Trello';
            addToast(`${label} disconnected.`, 'warning');
            await refresh();
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Disconnect failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    const syncProvider = async (provider: TaskPluginProviderId) => {
        if (!selectedWorkspaceId) return;
        setSyncingProvider(provider);
        try {
            const result = await api.taskPlugins.sync(selectedWorkspaceId, provider);
            const errNote = result.error ? ` (${result.error})` : '';
            addToast(
                `Sync complete. ${result.imported} imported, ${result.updated} updated.${errNote}`,
                result.error ? 'warning' : 'success',
            );
            await refresh();
            await fetchTasks();
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Sync failed', 'error');
        } finally {
            setSyncingProvider(null);
        }
    };

    const createLink = async (provider: TaskPluginProviderId) => {
        if (!selectedWorkspaceId || !linkForm.externalContainerId) return;
        if (linkForm.provider !== provider) return;
        const container = containersByProvider[provider]?.find((c) => c.id === linkForm.externalContainerId);
        setLoading(true);
        try {
            const result = await api.taskPlugins.createLink({
                workspaceId: selectedWorkspaceId,
                provider,
                projectId: linkForm.projectId || null,
                externalContainerId: linkForm.externalContainerId,
                externalContainerName: container ? containerLabel(container) : undefined,
            });
            addToast(
                `Container linked. ${result.imported} imported, ${result.updated} updated.`,
                'success',
            );
            setLinkForm({ provider, projectId: '', externalContainerId: '' });
            await refresh();
            await fetchTasks();
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
            await api.taskPlugins.deleteLink(selectedWorkspaceId, linkId);
            addToast('Container unlinked.', 'info');
            await refresh();
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Unlink failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    if (!selectedWorkspaceId) {
        return <p className="text-sm text-text-secondary">Select a workspace to manage task plugins.</p>;
    }

    if (!canManage) {
        return (
            <p className="text-sm text-text-secondary">
                You need the Manage Workflows permission to configure task plugins.
            </p>
        );
    }

    return (
        <PluginSection
            title="Tasks"
            description="Pull work items from boards and projects; sync on connect, manual refresh, or cron."
        >
            {isStatusLoading ? (
                <PluginsStatusLoading count={PROVIDER_CARDS.length} />
            ) : (
            PROVIDER_CARDS.map((card) => {
                const status = statusFor(card.provider);
                const connected = status?.connected ?? false;
                const configured = configuredFor(card.provider);
                const providerLinks = links.filter((l) => l.provider === card.provider);
                const containers = containersByProvider[card.provider] ?? [];
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
                                    {status.accountName && (
                                        <PluginMetaItem label="Account">
                                            {status.accountName}
                                        </PluginMetaItem>
                                    )}
                                    <PluginMetaItem label="Last sync">
                                        {status.lastSyncedAt
                                            ? new Date(status.lastSyncedAt).toLocaleString()
                                            : 'Never'}
                                    </PluginMetaItem>
                                    {providerLinks.length > 0 && (
                                        <PluginMetaItem label="Links">
                                            {providerLinks.length} container
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
                                        <ul className="divide-y divide-border-dark/80 overflow-hidden rounded-lg border border-border-dark">
                                            {providerLinks.map((link) => (
                                                <li
                                                    key={link.id}
                                                    className="flex items-center justify-between gap-3 bg-background-dark/30 px-3 py-2 text-xs"
                                                >
                                                    <span className="min-w-0 truncate text-text-secondary">
                                                        <span className="font-medium text-white">
                                                            {link.externalContainerName ??
                                                                link.externalContainerId}
                                                        </span>
                                                        <span className="mx-1.5 text-text-secondary/50">→</span>
                                                        {link.projectName ?? 'Workspace tasks'}
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
                                                External container
                                            </span>
                                            <select
                                                value={
                                                    linkForm.provider === card.provider
                                                        ? linkForm.externalContainerId
                                                        : ''
                                                }
                                                onChange={(e) =>
                                                    setLinkForm({
                                                        provider: card.provider,
                                                        projectId: linkForm.projectId,
                                                        externalContainerId: e.target.value,
                                                    })
                                                }
                                                className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-xs text-white"
                                            >
                                                <option value="">Select…</option>
                                                {containers.map((c) => (
                                                    <option key={c.id} value={c.id}>
                                                        {containerLabel(c)}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="block min-w-0">
                                            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-text-secondary/80">
                                                OneWork project
                                            </span>
                                            <select
                                                value={
                                                    linkForm.provider === card.provider
                                                        ? linkForm.projectId
                                                        : ''
                                                }
                                                onChange={(e) =>
                                                    setLinkForm({
                                                        provider: card.provider,
                                                        projectId: e.target.value,
                                                        externalContainerId: linkForm.externalContainerId,
                                                    })
                                                }
                                                className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-xs text-white"
                                            >
                                                <option value="">Optional</option>
                                                {projects.map((p) => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.name}
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
                                                !linkForm.externalContainerId
                                            }
                                            className={pluginBtnGhost}
                                        >
                                            Link & sync
                                        </button>
                                    </div>
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
