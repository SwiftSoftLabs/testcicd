'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useUIContext } from '@/context/UIContext';
import { useAppContext } from '@/context/AppContext';
import { useGitIntegrationStatus } from '@/hooks/useGitIntegration';
import { api } from '@/lib/api';
import {
    integrationStoredScopesLackSsh,
    missingSshScopesMessage,
} from '@/lib/integrations/git/ssh-scopes';
import type { GitProvider, GitSshKey } from '@/types/git';
import { GIT_PROVIDER_META } from '@/lib/integrations/git/provider-meta';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface GitCard {
    id: GitProvider;
    name: string;
    description: string;
    icon: string;
    color: string;
    isPlatform: boolean;
}

const GIT_CARDS: GitCard[] = (['onework', 'github', 'gitlab'] as const).map((id) => ({
    id,
    name: GIT_PROVIDER_META[id].label,
    description: GIT_PROVIDER_META[id].description,
    icon: GIT_PROVIDER_META[id].icon,
    color: GIT_PROVIDER_META[id].color,
    isPlatform: GIT_PROVIDER_META[id].isPlatformManaged,
}));

function formatDate(iso: string): string {
    try {
        return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
            new Date(iso),
        );
    } catch {
        return iso;
    }
}

const GitSSHSettings: React.FC = () => {
    const { currentUser, selectedWorkspaceId, selectedProjectId } = useAppContext();
    const { addToast, openModal } = useUIContext();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { status: gitStatus, reload: reloadGit } = useGitIntegrationStatus(selectedWorkspaceId ?? null);

    const [gitName, setGitName] = useState('');
    const [gitEmail, setGitEmail] = useState('');
    const [savingIdentity, setSavingIdentity] = useState(false);

    const [sshProvider, setSshProvider] = useState<GitProvider>('onework');
    const [sshKeys, setSshKeys] = useState<GitSshKey[]>([]);
    const [sshAccountLogin, setSshAccountLogin] = useState<string | null>(null);
    const [sshLoading, setSshLoading] = useState(false);
    const [sshLoadError, setSshLoadError] = useState<string | null>(null);
    const [sshScopeHint, setSshScopeHint] = useState<string | null>(null);

    const [isAddingKey, setIsAddingKey] = useState(false);
    const [newKeyName, setNewKeyName] = useState('');
    const [newKeyBody, setNewKeyBody] = useState('');
    const [savingKey, setSavingKey] = useState(false);
    const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);

    useEffect(() => {
        if (!currentUser?.id) return;
        void (async () => {
            try {
                const res = await authenticatedFetch(`/api/profile/me?userId=${encodeURIComponent(currentUser.id)}`, {
                    credentials: 'include',
                });
                const json = (await res.json()) as {
                    data?: { git_name?: string | null; git_email?: string | null; full_name?: string; email?: string };
                };
                const p = json.data;
                setGitName(p?.git_name?.trim() || p?.full_name?.trim() || currentUser.name || '');
                setGitEmail(p?.git_email?.trim() || p?.email?.trim() || currentUser.email || '');
            } catch {
                setGitName(currentUser.name || '');
                setGitEmail(currentUser.email || '');
            }
        })();
    }, [currentUser?.id, currentUser.name, currentUser.email]);

    useEffect(() => {
        const ssh = searchParams.get('ssh');
        if (ssh === 'onework' || ssh === 'github' || ssh === 'gitlab') {
            setSshProvider(ssh);
        }
    }, [searchParams]);

    useEffect(() => {
        const integration = searchParams.get('integration') as GitProvider | null;
        const status = searchParams.get('status');
        const error = searchParams.get('error');
        const pickRepos = searchParams.get('pickRepos');
        const projectId = searchParams.get('projectId');

        if (!status && !error) return;

        const sig = searchParams.toString();
        if (typeof window !== 'undefined') {
            const dedupeKey = `ow-git-oauth-return:${sig}`;
            if (sessionStorage.getItem(dedupeKey)) return;
            sessionStorage.setItem(dedupeKey, '1');
        }

        if (status === 'connected' && (integration === 'github' || integration === 'gitlab')) {
            addToast(`${integration === 'github' ? 'GitHub' : 'GitLab'} connected.`, 'success');
            void reloadGit().then(() => {
                if (
                    pickRepos === '1' &&
                    projectId &&
                    selectedWorkspaceId &&
                    (integration === 'github' || integration === 'gitlab')
                ) {
                    openModal('git-linked-repos', {
                        workspaceId: selectedWorkspaceId,
                        projectId,
                        provider: integration,
                        onSaved: () => void reloadGit(),
                    });
                }
            });
        } else if (status === 'error') {
            addToast(error ?? 'Git integration failed', 'error');
            void reloadGit();
        }

        router.replace('/settings/git-ssh');
    }, [searchParams, addToast, reloadGit, router, selectedWorkspaceId, openModal]);

    const gitAccounts = useMemo(() => {
        const ow = gitStatus?.onework;
        const gh = gitStatus?.github;
        const gl = gitStatus?.gitlab;
        return GIT_CARDS.map((card) => {
            const st =
                card.id === 'onework' ? ow : card.id === 'github' ? gh : gl;
            const connected =
                card.isPlatform
                    ? Boolean(gitStatus?.oneworkVcConfigured && st?.status === 'connected')
                    : st?.status === 'connected';
            return {
                ...card,
                connected,
                username: connected ? st?.accountLogin ?? null : null,
                oauthConfigured:
                    card.id === 'github'
                        ? Boolean(gitStatus?.oauthGithubConfigured)
                        : card.id === 'gitlab'
                          ? Boolean(gitStatus?.oauthGitlabConfigured)
                          : true,
            };
        });
    }, [gitStatus]);

    const sshProviderConnected = useMemo(() => {
        if (sshProvider === 'onework') {
            return Boolean(
                gitStatus?.oneworkVcConfigured &&
                    gitStatus?.onework?.status === 'connected',
            );
        }
        const acc = gitAccounts.find((a) => a.id === sshProvider);
        return Boolean(acc?.connected);
    }, [gitAccounts, sshProvider, gitStatus]);

    const sshIntegration = useMemo(() => {
        if (sshProvider === 'github') return gitStatus?.github ?? null;
        if (sshProvider === 'gitlab') return gitStatus?.gitlab ?? null;
        return gitStatus?.onework ?? null;
    }, [gitStatus, sshProvider]);

    const sshProviderLabel =
        sshProvider === 'onework'
            ? 'OneWork Version Control'
            : sshProvider === 'github'
              ? 'GitHub'
              : 'GitLab';

    const loadSshKeys = useCallback(async () => {
        if (!selectedWorkspaceId || !sshProviderConnected) {
            setSshKeys([]);
            setSshAccountLogin(null);
            setSshScopeHint(null);
            setSshLoadError(null);
            return;
        }

        const integration = sshIntegration;
        if (
            integration?.status === 'connected' &&
            integrationStoredScopesLackSsh(sshProvider, integration.authMethod, integration.scopes)
        ) {
            setSshKeys([]);
            setSshAccountLogin(integration.accountLogin);
            setSshLoadError(null);
            setSshScopeHint(missingSshScopesMessage(sshProvider, integration.authMethod));
            return;
        }

        setSshLoading(true);
        setSshScopeHint(null);
        setSshLoadError(null);
        try {
            const res = await api.integrations.git.sshKeys.list(selectedWorkspaceId, sshProvider);
            setSshKeys(res.data);
            setSshAccountLogin(res.accountLogin || integration?.accountLogin || null);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to load SSH keys';
            const code =
                e && typeof e === 'object' && 'code' in e
                    ? (e as { code?: string }).code
                    : undefined;
            setSshKeys([]);
            setSshAccountLogin(integration?.accountLogin ?? null);
            setSshLoadError(msg);
            if (
                code === 'MISSING_SSH_SCOPES' ||
                /scope|permission|403|401|SSH key/i.test(msg)
            ) {
                setSshScopeHint(
                    integration
                        ? missingSshScopesMessage(sshProvider, integration.authMethod)
                        : 'Disconnect and reconnect this provider to grant SSH key access.',
                );
            } else {
                addToast(msg, 'error');
            }
        } finally {
            setSshLoading(false);
        }
    }, [selectedWorkspaceId, sshProvider, sshProviderConnected, sshIntegration, addToast]);

    useEffect(() => {
        void loadSshKeys();
    }, [loadSshKeys]);

    const disconnectGit = async (provider: GitProvider) => {
        if (provider === 'onework') return;
        if (!selectedWorkspaceId) {
            addToast('Select a workspace before disconnecting.', 'warning');
            return;
        }
        try {
            await api.integrations.git.disconnect(provider, selectedWorkspaceId);
            addToast(`Disconnected from ${provider === 'github' ? 'GitHub' : 'GitLab'}.`, 'warning');
            await reloadGit();
        } catch (e) {
            addToast(e instanceof Error ? e.message : 'Could not disconnect', 'error');
        }
    };

    const openRepoPicker = (provider: GitProvider) => {
        if (provider === 'onework') return;
        if (!selectedWorkspaceId || !selectedProjectId) {
            addToast('Select a workspace and a project in the app header, then pick repositories for Version Control.', 'warning');
            return;
        }
        openModal('git-linked-repos', {
            workspaceId: selectedWorkspaceId,
            projectId: selectedProjectId,
            provider,
            onSaved: () => void reloadGit(),
        });
    };

    const connectGit = (provider: GitProvider, name: string, oauthConfigured: boolean) => {
        if (provider === 'onework') return;
        if (!selectedWorkspaceId || !selectedProjectId) {
            addToast('Select a workspace and a project in the header before connecting Git.', 'warning');
            return;
        }
        openModal('oauth-simulation', {
            provider,
            workspaceId: selectedWorkspaceId,
            projectId: selectedProjectId,
            oauthConfigured,
            onConnected: async () => {
                await reloadGit();
                addToast(`${name} connected.`, 'success');
            },
            afterSessionEstablished: () => openRepoPicker(provider),
        });
    };

    const saveGitIdentity = async () => {
        setSavingIdentity(true);
        try {
            const res = await authenticatedFetch('/api/profile/me', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    git_name: gitName.trim() || null,
                    git_email: gitEmail.trim() || null,
                }),
            });
            const json = (await res.json()) as { error?: string };
            if (!res.ok) throw new Error(json.error || 'Failed to save');
            addToast('Git identity saved.', 'success');
        } catch (e) {
            addToast(e instanceof Error ? e.message : 'Failed to save git identity', 'error');
        } finally {
            setSavingIdentity(false);
        }
    };

    const handleSaveNewKey = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedWorkspaceId) {
            addToast('Select a workspace first.', 'warning');
            return;
        }
        if (!newKeyName.trim() || !newKeyBody.trim()) {
            addToast('Please provide both a name and the public key.', 'warning');
            return;
        }
        setSavingKey(true);
        try {
            await api.integrations.git.sshKeys.create({
                workspaceId: selectedWorkspaceId,
                provider: sshProvider,
                title: newKeyName.trim(),
                key: newKeyBody.trim(),
            });
            setIsAddingKey(false);
            setNewKeyName('');
            setNewKeyBody('');
            addToast('SSH key added to your account.', 'success');
            await loadSshKeys();
        } catch (err) {
            addToast(err instanceof Error ? err.message : 'Failed to add SSH key', 'error');
        } finally {
            setSavingKey(false);
        }
    };

    const removeSshKey = async (keyId: string) => {
        if (!selectedWorkspaceId) return;
        setDeletingKeyId(keyId);
        try {
            await api.integrations.git.sshKeys.delete(selectedWorkspaceId, sshProvider, keyId);
            addToast('SSH key removed.', 'success');
            await loadSshKeys();
        } catch (err) {
            addToast(err instanceof Error ? err.message : 'Failed to remove SSH key', 'error');
        } finally {
            setDeletingKeyId(null);
        }
    };

    return (
        <div className="min-w-0 max-w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm">
                <h3 className="text-lg font-bold text-white mb-2">Git Identity</h3>
                <p className="text-sm text-text-secondary mb-6">
                    Stored in your OneWork profile for reference. Configure the same name and email in your local{' '}
                    <code className="text-xs bg-white/5 px-1 rounded">git config</code> so commits match.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Name</label>
                        <input
                            type="text"
                            value={gitName}
                            onChange={(e) => setGitName(e.target.value)}
                            className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all outline-none"
                            placeholder="Your git name"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Email</label>
                        <input
                            type="email"
                            value={gitEmail}
                            onChange={(e) => setGitEmail(e.target.value)}
                            className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all outline-none"
                            placeholder="Your git email"
                        />
                    </div>
                </div>
                <div className="mt-6 flex justify-end">
                    <button
                        type="button"
                        onClick={() => void saveGitIdentity()}
                        disabled={savingIdentity}
                        className="cursor-pointer px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:bg-blue-600 disabled:opacity-50 transition-all"
                    >
                        {savingIdentity ? 'Saving…' : 'Save identity'}
                    </button>
                </div>
            </section>

            <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm">
                <h3 className="text-lg font-bold text-white mb-2">Git providers</h3>
                <p className="text-sm text-text-secondary mb-6">
                    Connect per workspace (OAuth or PAT). You must select a <span className="text-white font-semibold">project</span> in the app header, then choose which repositories appear on Version Control for that project.
                </p>
                <div className="space-y-4">
                    {gitAccounts.map(account => (
                        <div key={account.id} className="bg-background-dark/30 border border-border-dark rounded-xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 group hover:border-white/10 transition-all">
                            <div className="flex min-w-0 items-center gap-5">
                                <div className="size-12 bg-white rounded-xl flex items-center justify-center shrink-0">
                                    {account.isPlatform ? (
                                        <span className="material-symbols-outlined text-primary text-3xl">
                                            {account.icon}
                                        </span>
                                    ) : (
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        <img src={`https://cdn.simpleicons.org/${account.icon}/${account.color}`} className="size-8" alt={account.name} />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <h4 className="text-sm font-bold text-white">{account.name}</h4>
                                    <p className="text-xs text-text-secondary mt-0.5 break-words">{account.description}</p>
                                    {account.isPlatform ? (
                                        <div className="flex items-center gap-2 text-xs mt-2">
                                            <span className="size-1.5 rounded-full bg-emerald-500" />
                                            <span className="text-emerald-500 font-medium">
                                                Included with your workspace
                                                {account.username ? ` · @${account.username}` : ''}
                                            </span>
                                        </div>
                                    ) : account.connected ? (
                                        <div className="flex items-center gap-2 text-xs mt-2">
                                            <span className="size-1.5 rounded-full bg-emerald-500" />
                                            <span className="text-emerald-500 font-medium">Connected as @{account.username}</span>
                                        </div>
                                    ) : !account.oauthConfigured ? (
                                        <p className="text-[11px] text-amber-400/90 mt-2">
                                            OAuth not configured for this environment — use a personal access token in the connect dialog.
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                                {!account.isPlatform && account.connected && (
                                    <button
                                        type="button"
                                        onClick={() => openRepoPicker(account.id)}
                                        className="cursor-pointer px-6 py-2 rounded-lg text-xs font-bold border border-primary/40 text-primary hover:bg-primary/10 transition-all"
                                    >
                                        Repositories
                                    </button>
                                )}
                                {!account.isPlatform && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (account.connected) void disconnectGit(account.id);
                                        else connectGit(account.id, account.name, account.oauthConfigured);
                                    }}
                                    className={`cursor-pointer px-6 py-2 rounded-lg text-xs font-bold border transition-all ${account.connected
                                        ? 'bg-transparent border-border-dark text-text-secondary hover:text-white hover:border-white/20'
                                        : 'bg-primary border-primary text-white hover:bg-blue-600'
                                        }`}
                                >
                                    {account.connected ? 'Disconnect' : 'Connect'}
                                </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
                    <h3 className="text-lg font-bold text-white">SSH Keys</h3>
                    <div className="flex gap-2 flex-wrap">
                        {(['onework', 'github', 'gitlab'] as const).map((p) => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => setSshProvider(p)}
                                className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${sshProvider === p
                                    ? 'bg-primary/10 text-primary border-primary/30'
                                    : 'text-text-secondary border-border-dark hover:text-white'
                                    }`}
                            >
                                {p === 'onework'
                                    ? 'OneWork'
                                    : p === 'github'
                                      ? 'GitHub'
                                      : 'GitLab'}
                            </button>
                        ))}
                    </div>
                </div>
                <p className="text-sm text-text-secondary mb-4">
                    {sshProvider === 'onework'
                        ? 'Keys are added to your OneWork Version Control account for SSH clone and push.'
                        : `Keys are added to your ${sshProviderLabel} account (same as their website). Use them to clone with SSH from Version Control.`}
                </p>

                {sshProvider === 'onework' && gitStatus?.oneworkVcConfigured && (
                    <div className="text-xs text-text-secondary border border-border-dark bg-background-dark/40 rounded-xl px-4 py-3 mb-4 space-y-1">
                        <p className="font-bold text-main">SSH server</p>
                        <p>
                            Host:{' '}
                            <span className="font-mono text-main">
                                {gitStatus.oneworkSshHost || '—'}
                            </span>
                            {' · '}
                            Port:{' '}
                            <span className="font-mono text-main">
                                {gitStatus.oneworkSshPort || '2222'}
                            </span>
                        </p>
                        <p className="leading-relaxed">
                            Clone URL format:{' '}
                            <span className="font-mono text-main">
                                ssh://git@
                                {gitStatus.oneworkSshHost || 'host'}:
                                {gitStatus.oneworkSshPort || '2222'}/org/repo.git
                            </span>
                        </p>
                    </div>
                )}

                {!selectedWorkspaceId && (
                    <p className="text-xs text-amber-400/90 border border-amber-500/20 bg-amber-500/5 rounded-xl px-4 py-3 mb-4">
                        Select a workspace in the header to manage SSH keys.
                    </p>
                )}

                {selectedWorkspaceId && !sshProviderConnected && (
                    <p className="text-xs text-amber-400/90 border border-amber-500/20 bg-amber-500/5 rounded-xl px-4 py-3 mb-4">
                        {sshProvider === 'onework' ? (
                            <>
                                OneWork Version Control is still setting up for your account.
                                {gitStatus?.oneworkProvisionError ? (
                                    <span className="block mt-1 text-amber-300/90">
                                        {gitStatus.oneworkProvisionError}
                                    </span>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => void reloadGit()}
                                    className="cursor-pointer block mt-2 text-xs font-bold text-primary hover:underline"
                                >
                                    Retry setup
                                </button>
                            </>
                        ) : (
                            <>Connect {sshProviderLabel} above to list and manage SSH keys.</>
                        )}
                    </p>
                )}

                {sshScopeHint && (
                    <div className="text-xs text-amber-400/90 border border-amber-500/20 bg-amber-500/5 rounded-xl px-4 py-3 mb-4 space-y-3">
                        <p>{sshScopeHint}</p>
                        {sshProviderConnected && selectedWorkspaceId && selectedProjectId && (
                            <button
                                type="button"
                                onClick={() => {
                                    const card = gitAccounts.find((a) => a.id === sshProvider);
                                    if (card) {
                                        connectGit(sshProvider, card.name, card.oauthConfigured);
                                    }
                                }}
                                className="cursor-pointer text-xs font-bold text-primary hover:underline"
                            >
                                Reconnect {sshProvider === 'github' ? 'GitHub' : 'GitLab'}
                            </button>
                        )}
                    </div>
                )}

                {sshLoadError && !sshScopeHint && (
                    <p className="text-xs text-red-400/90 border border-red-500/20 bg-red-500/5 rounded-xl px-4 py-3 mb-4">
                        {sshLoadError}
                    </p>
                )}

                {sshProviderConnected && sshAccountLogin && (
                    <p className="text-xs text-text-secondary mb-4">
                        Managing keys for <span className="text-white font-semibold">@{sshAccountLogin}</span>
                    </p>
                )}

                {sshProviderConnected && !isAddingKey && !sshScopeHint && (
                    <div className="flex justify-end mb-6">
                        <button
                            type="button"
                            onClick={() => setIsAddingKey(true)}
                            className="cursor-pointer bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 shadow-lg shadow-primary/20 transition-all active:scale-95"
                        >
                            <span className="material-symbols-outlined text-sm">add</span> New SSH Key
                        </button>
                    </div>
                )}

                {isAddingKey && (
                    <form onSubmit={handleSaveNewKey} className="mb-8 p-6 border border-primary/30 bg-primary/5 rounded-2xl animate-in zoom-in-95 duration-200">
                        <h4 className="text-sm font-bold text-white mb-4">Add SSH Key</h4>
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Title</label>
                                <input
                                    type="text"
                                    autoFocus
                                    value={newKeyName}
                                    onChange={(e) => setNewKeyName(e.target.value)}
                                    className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all outline-none"
                                    placeholder="e.g. Personal Laptop"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Public Key</label>
                                <textarea
                                    value={newKeyBody}
                                    onChange={(e) => setNewKeyBody(e.target.value)}
                                    rows={4}
                                    className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-xs font-mono focus:ring-1 focus:ring-primary focus:border-primary px-4 py-3 transition-all resize-none outline-none"
                                    placeholder="ssh-ed25519 AAAA... comment"
                                />
                            </div>
                            <p className="text-[10px] text-text-secondary">
                                Paste the contents of your <code className="bg-white/5 px-1 rounded">.pub</code> file. Never paste a private key.
                            </p>
                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsAddingKey(false)}
                                    className="cursor-pointer px-4 py-2 text-text-secondary text-xs font-bold hover:text-white transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={savingKey}
                                    className="cursor-pointer px-6 py-2 bg-primary text-white text-xs font-bold rounded-lg shadow-lg hover:bg-blue-600 disabled:opacity-50 transition-all"
                                >
                                    {savingKey ? 'Adding…' : 'Add Key'}
                                </button>
                            </div>
                        </div>
                    </form>
                )}

                {sshLoading ? (
                    <p className="text-sm text-text-secondary py-8 text-center">Loading SSH keys…</p>
                ) : sshKeys.length === 0 && sshProviderConnected && !sshScopeHint && !sshLoadError ? (
                    <p className="text-sm text-text-secondary py-8 text-center border border-dashed border-border-dark rounded-xl">
                        No SSH keys on this {sshProviderLabel} account yet.
                    </p>
                ) : sshScopeHint || sshLoadError ? null : (
                    <div className="space-y-4">
                        {sshKeys.map((key) => (
                            <div
                                key={key.id}
                                className="bg-background-dark/30 border border-border-dark rounded-xl p-5 flex items-center justify-between group hover:border-white/10 transition-all"
                            >
                                <div className="flex items-center gap-5 min-w-0">
                                    <div className="size-12 bg-surface-highlight rounded-xl flex items-center justify-center text-text-secondary shrink-0">
                                        <span className="material-symbols-outlined text-2xl">vpn_key</span>
                                    </div>
                                    <div className="space-y-1 min-w-0">
                                        <h4 className="text-sm font-bold text-white truncate">
                                            {key.title}
                                            {key.readOnly ? (
                                                <span className="ml-2 text-[10px] text-text-secondary font-normal">(read-only)</span>
                                            ) : null}
                                        </h4>
                                        <p className="text-xs font-mono text-text-secondary truncate">{key.fingerprint}</p>
                                        <p className="text-[10px] text-text-secondary uppercase font-bold tracking-tighter">
                                            Added {formatDate(key.createdAt)}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void removeSshKey(key.id)}
                                    disabled={deletingKeyId === key.id || key.readOnly}
                                    title={key.readOnly ? 'Read-only keys cannot be removed via API' : 'Remove key'}
                                    className="cursor-pointer p-2 text-text-secondary hover:text-red-400 disabled:opacity-30 transition-colors shrink-0"
                                >
                                    <span className="material-symbols-outlined">delete</span>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
};

export default GitSSHSettings;
