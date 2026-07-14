'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { PlanCode, SubscriptionStatus } from '@/types/billing';
import type { VaultEnvironment } from '@/types/vault';
import {
    formatVaultPlanLabel,
    vaultBillingPlanMismatch,
} from '@/lib/vault/plan-tier';
import { useOpenPlanComparisonModal } from '@/hooks/useOpenPlanComparisonModal';
import AddGitHubSyncTargetModal from './AddGitHubSyncTargetModal';
import AddVercelSyncTargetModal from './AddVercelSyncTargetModal';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface SyncTargetRow {
    id: string;
    name: string;
    provider: 'github' | 'vercel';
    config: {
        // GitHub
        owner?: string;
        repo?: string;
        environmentName?: string | null;
        // Vercel
        vercelProjectName?: string;
        targets?: string[];
        // shared
        variableMode: 'all' | 'subset';
        selectedVariableNames?: string[];
        vaultEnvironmentId: string;
    };
    created_at: string;
    updated_at: string;
    lastEvent: {
        status: string;
        updated_at: string | null;
        pushed: number | null;
        failed: { name: string; error: string }[] | null;
    } | null;
}

const ADMIN_SYNC_FORBIDDEN = 'Admin or owner access required';

interface Props {
    projectId: string;
    workspaceId: string;
    vaultEnvironments: VaultEnvironment[];
    isPro: boolean;
    isVaultAdmin: boolean;
    planCode: string;
    subscriptionPlanCode: PlanCode;
    subscriptionStatus: SubscriptionStatus;
    canManageBilling?: boolean;
    addToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

function isSyncFetchErrorSuppressed(status: number, error: string | undefined): boolean {
    return (
        status === 403 &&
        (error === 'Upgrade required' || error === ADMIN_SYNC_FORBIDDEN)
    );
}

function LastSyncBadge({ event }: { event: SyncTargetRow['lastEvent'] }) {
    if (!event) return <span className="text-xs text-text-muted">Never synced</span>;

    const timeAgo = event.updated_at
        ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
              Math.round((new Date(event.updated_at).getTime() - Date.now()) / 60000),
              'minute'
          )
        : null;

    if (event.status === 'running') {
        return (
            <span className="flex items-center gap-1 text-xs text-blue-400">
                <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                Syncing…
            </span>
        );
    }
    if (event.status === 'completed') {
        return (
            <span className="text-xs text-emerald-400">
                ✓ {event.pushed ?? 0} pushed{timeAgo ? ` · ${timeAgo}` : ''}
            </span>
        );
    }
    if (event.status === 'failed') {
        const failCount = Array.isArray(event.failed) ? event.failed.length : 0;
        const firstError = Array.isArray(event.failed) && event.failed[0] ? event.failed[0].error : 'Unknown error';
        return (
            <span className="text-xs text-red-400" title={firstError}>
                ✗ {failCount > 0 ? `${failCount} failed` : 'Failed'}{timeAgo ? ` · ${timeAgo}` : ''}
            </span>
        );
    }
    return <span className="text-xs text-text-muted">{event.status}</span>;
}

function ProviderIcon({ provider }: { provider: 'github' | 'vercel' }) {
    if (provider === 'vercel') {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="https://cdn.simpleicons.org/vercel/ffffff" alt="" className="size-3.5 opacity-60 mt-0.5 shrink-0" />
        );
    }
    return <span className="material-symbols-outlined text-base text-text-muted mt-0.5 shrink-0">hub</span>;
}

function targetSubtitle(target: SyncTargetRow): string {
    if (target.provider === 'github') {
        const base = `${target.config.owner ?? ''}/${target.config.repo ?? ''}`;
        return target.config.environmentName ? `${base} · ${target.config.environmentName}` : base;
    }
    if (target.provider === 'vercel') {
        const name = target.config.vercelProjectName ?? target.name;
        const envs = (target.config.targets ?? []).join(', ');
        return envs ? `${name} · ${envs}` : name;
    }
    return '';
}

export default function VaultSyncTargetsPanel({
    projectId,
    workspaceId,
    vaultEnvironments,
    isPro,
    isVaultAdmin,
    planCode,
    subscriptionPlanCode,
    subscriptionStatus,
    canManageBilling = false,
    addToast,
}: Props) {
    const canManageSync = isPro && isVaultAdmin;
    const billingMismatch = vaultBillingPlanMismatch(subscriptionPlanCode, planCode);
    const openPlanComparison = useOpenPlanComparisonModal(workspaceId);
    const [targets, setTargets] = useState<SyncTargetRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [addProvider, setAddProvider] = useState<'github' | 'vercel' | null>(null);
    const [showProviderMenu, setShowProviderMenu] = useState(false);
    const [syncing, setSyncing] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<SyncTargetRow | null>(null);
    const [deleting, setDeleting] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const fetchTargets = useCallback(async () => {
        if (!canManageSync) {
            setTargets([]);
            return;
        }
        setLoading(true);
        try {
            const res = await authenticatedFetch(`/api/vault/sync-targets?projectId=${projectId}`);
            const json = await res.json();
            if (!res.ok) {
                if (isSyncFetchErrorSuppressed(res.status, json.error)) {
                    setTargets([]);
                    return;
                }
                addToast(json.error ?? 'Failed to load sync targets', 'error');
                return;
            }
            setTargets(json.data ?? []);
        } catch {
            addToast('Failed to load sync targets', 'error');
        } finally {
            setLoading(false);
        }
    }, [projectId, canManageSync, addToast]);

    useEffect(() => {
        fetchTargets();
    }, [fetchTargets]);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowProviderMenu(false);
            }
        }
        if (showProviderMenu) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showProviderMenu]);

    async function handleSync(target: SyncTargetRow) {
        setSyncing(target.id);
        const endpoint = target.provider === 'vercel' ? '/api/vault/sync/vercel' : '/api/vault/sync/github';
        try {
            const res = await authenticatedFetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, syncTargetId: target.id }),
            });
            const json = await res.json();
            if (!res.ok) {
                addToast(json.error ?? 'Sync failed', 'error');
            } else {
                const { pushed, failed } = json.data;
                const providerLabel = target.provider === 'vercel' ? 'Vercel' : 'GitHub';
                if (failed?.length > 0) {
                    addToast(`Synced ${pushed} variable${pushed !== 1 ? 's' : ''}, ${failed.length} failed`, 'warning');
                } else {
                    addToast(`Synced ${pushed} variable${pushed !== 1 ? 's' : ''} to ${providerLabel}`, 'success');
                }
                fetchTargets();
            }
        } catch {
            addToast('Network error during sync', 'error');
        } finally {
            setSyncing(null);
        }
    }

    async function handleDelete() {
        if (!deleteConfirm) return;
        setDeleting(true);
        try {
            const res = await authenticatedFetch('/api/vault/sync-targets', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: deleteConfirm.id, projectId }),
            });
            const json = await res.json();
            if (!res.ok) { addToast(json.error ?? 'Delete failed', 'error'); return; }
            setTargets((prev) => prev.filter((t) => t.id !== deleteConfirm.id));
            setDeleteConfirm(null);
            addToast('Sync target removed', 'success');
        } catch {
            addToast('Network error', 'error');
        } finally {
            setDeleting(false);
        }
    }

    const reconnectLink = (target: SyncTargetRow) => {
        if (!target.lastEvent?.failed) return null;
        const hasReconnect = Array.isArray(target.lastEvent.failed) &&
            target.lastEvent.failed.some((f) => f.error.includes('Reconnect'));
        if (!hasReconnect) return null;
        const href = target.provider === 'vercel' ? '/settings/plugins' : '/settings/git-ssh';
        const label = target.provider === 'vercel' ? 'Reconnect Vercel' : 'Reconnect GitHub';
        return (
            <a href={href} className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
                {label}
            </a>
        );
    };

    return (
        <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-text-muted">sync</span>
                    <span className="text-sm font-medium text-text-primary">Sync Targets</span>
                    <span className="text-xs text-text-muted bg-surface-dark-2 px-1.5 py-0.5 rounded border border-border-dark capitalize">
                        {formatVaultPlanLabel(planCode)}
                    </span>
                    {!isPro && (
                        <span className="text-xs text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
                            Requires Pro
                        </span>
                    )}
                </div>
                {canManageSync && (
                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={() => setShowProviderMenu((v) => !v)}
                            className="cursor-pointer flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                            <span className="material-symbols-outlined text-base">add</span>
                            Add
                        </button>
                        {showProviderMenu && (
                            <div className="absolute right-0 top-full mt-1 z-20 bg-surface-dark border border-border-dark rounded-lg shadow-xl py-1 w-44">
                                <button
                                    onClick={() => { setAddProvider('github'); setShowProviderMenu(false); }}
                                    className="cursor-pointer w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-dark-2 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-base">hub</span>
                                    GitHub Actions
                                </button>
                                <button
                                    onClick={() => { setAddProvider('vercel'); setShowProviderMenu(false); }}
                                    className="cursor-pointer w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-dark-2 transition-colors"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src="https://cdn.simpleicons.org/vercel/ffffff" alt="" className="size-3.5 opacity-60" />
                                    Vercel
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {!isPro ? (
                <div className="bg-surface-dark border border-border-dark rounded-xl px-4 py-5 text-center">
                    <span className="material-symbols-outlined text-2xl text-text-muted opacity-40 mb-2 block">sync</span>
                    {billingMismatch ? (
                        <>
                            <p className="text-sm text-text-secondary mb-1">Sync needs billing attention</p>
                            <p className="text-xs text-text-muted">
                                Recorded plan {formatVaultPlanLabel(subscriptionPlanCode)} ({subscriptionStatus}) but
                                vault entitlements are {formatVaultPlanLabel(planCode)}. Activate the subscription or
                                use manual status for enterprise provisioning.
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-text-secondary mb-1">Sync on Pro, Max, and Enterprise</p>
                            <p className="text-xs text-text-muted mb-3">
                                Upgrade to Pro to push vault secrets directly to GitHub Actions and Vercel.
                            </p>
                            {canManageBilling ? (
                                <button
                                    type="button"
                                    onClick={() =>
                                        openPlanComparison({
                                            note: 'Upgrade to Pro to use vault sync targets.',
                                            canManageBilling,
                                            currentPlan: planCode,
                                        })
                                    }
                                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                                >
                                    View plans
                                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                                </button>
                            ) : (
                                <p className="text-xs text-text-muted">Ask a workspace admin to upgrade to Pro.</p>
                            )}
                        </>
                    )}
                </div>
            ) : isPro && !isVaultAdmin ? (
                <div className="bg-surface-dark border border-border-dark rounded-xl px-4 py-5 text-center">
                    <span className="material-symbols-outlined text-2xl text-text-muted opacity-40 mb-2 block">sync</span>
                    <p className="text-sm text-text-secondary mb-1">Sync targets are managed by workspace admins</p>
                    <p className="text-xs text-text-muted">
                        Ask an admin to configure GitHub Actions or Vercel sync for this project.
                    </p>
                </div>
            ) : loading ? (
                <div className="flex items-center justify-center h-16">
                    <span className="material-symbols-outlined animate-spin text-text-muted">progress_activity</span>
                </div>
            ) : targets.length === 0 ? (
                <div className="bg-surface-dark border border-border-dark rounded-xl px-4 py-5 text-center">
                    <p className="text-sm text-text-secondary mb-1">No sync targets yet</p>
                    <p className="text-xs text-text-muted mb-3">Push vault secrets to GitHub Actions or Vercel automatically.</p>
                    <button
                        onClick={() => setShowProviderMenu(true)}
                        className="cursor-pointer text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                        Add your first sync target
                    </button>
                </div>
            ) : (
                <div className="bg-surface-dark border border-border-dark rounded-xl overflow-hidden divide-y divide-border-dark">
                    {targets.map((target) => (
                        <div key={target.id} className="px-4 py-3 flex items-start gap-3 group">
                            <ProviderIcon provider={target.provider} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-text-primary truncate">{target.name}</span>
                                    <span className="text-xs text-text-muted shrink-0 truncate max-w-[160px]" title={targetSubtitle(target)}>
                                        {targetSubtitle(target)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 mt-1">
                                    <LastSyncBadge event={target.lastEvent} />
                                    {target.lastEvent?.status === 'failed' && reconnectLink(target)}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    onClick={() => handleSync(target)}
                                    disabled={syncing === target.id}
                                    title="Sync now"
                                    className="cursor-pointer flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-secondary border border-border-dark rounded-lg hover:text-text-primary hover:border-border-dark-hover transition-colors disabled:opacity-40"
                                >
                                    <span className={`material-symbols-outlined text-sm ${syncing === target.id ? 'animate-spin' : ''}`}>
                                        {syncing === target.id ? 'progress_activity' : 'sync'}
                                    </span>
                                    {syncing === target.id ? 'Syncing…' : 'Sync now'}
                                </button>
                                <button
                                    onClick={() => setDeleteConfirm(target)}
                                    title="Remove sync target"
                                    className="cursor-pointer opacity-0 group-hover:opacity-100 p-1.5 text-text-muted hover:text-red-400 transition-all rounded-md hover:bg-surface-dark-2"
                                >
                                    <span className="material-symbols-outlined text-base">delete</span>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {addProvider === 'github' && (
                <AddGitHubSyncTargetModal
                    projectId={projectId}
                    workspaceId={workspaceId}
                    vaultEnvironments={vaultEnvironments}
                    onSave={() => {
                        setAddProvider(null);
                        fetchTargets();
                    }}
                    onClose={() => setAddProvider(null)}
                    addToast={addToast}
                />
            )}

            {addProvider === 'vercel' && (
                <AddVercelSyncTargetModal
                    projectId={projectId}
                    workspaceId={workspaceId}
                    vaultEnvironments={vaultEnvironments}
                    onSave={() => {
                        setAddProvider(null);
                        fetchTargets();
                    }}
                    onClose={() => setAddProvider(null)}
                    addToast={addToast}
                />
            )}

            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-sm p-6 shadow-2xl">
                        <h3 className="text-base font-semibold text-text-primary mb-2">Remove Sync Target</h3>
                        <p className="text-sm text-text-secondary mb-5">
                            Remove <span className="font-medium text-text-primary">{deleteConfirm.name}</span>?{' '}
                            Existing secrets in {deleteConfirm.provider === 'vercel' ? 'Vercel' : 'GitHub'} will not be deleted.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="cursor-pointer flex-1 px-4 py-2 rounded-lg border border-border-dark text-sm text-text-secondary hover:text-text-primary transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                className="cursor-pointer flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                            >
                                {deleting ? 'Removing…' : 'Remove'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
