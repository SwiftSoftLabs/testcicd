'use client';

import { useState, useCallback, useEffect } from 'react';
import type { PlanCode, SubscriptionStatus } from '@/types/billing';
import type { VaultCliToken, VaultCliTokenWithPlaintext, VaultEnvironment } from '@/types/vault';
import {
    formatVaultPlanLabel,
    vaultBillingPlanMismatch,
} from '@/lib/vault/plan-tier';
import CreateCliTokenModal from './CreateCliTokenModal';
import RevealTokenModal from './RevealTokenModal';
import CliUsageModal from './CliUsageModal';
import { useOpenPlanComparisonModal } from '@/hooks/useOpenPlanComparisonModal';
import { useAppContext } from '@/context/AppContext';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface Props {
    projectId: string;
    vaultEnvironments: VaultEnvironment[];
    isVaultAdmin: boolean;
    isMax: boolean;
    planCode: string;
    subscriptionPlanCode: PlanCode;
    subscriptionStatus: SubscriptionStatus;
    canManageBilling?: boolean;
    addToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

function tokenStatus(token: VaultCliToken): 'active' | 'expired' | 'revoked' {
    if (token.revoked_at) return 'revoked';
    if (new Date(token.expires_at) < new Date()) return 'expired';
    return 'active';
}

function formatRelative(dateStr: string): string {
    const diff = new Date(dateStr).getTime() - Date.now();
    const abs = Math.abs(diff);
    const past = diff < 0;
    if (abs < 60_000) return past ? 'just now' : 'in a moment';
    if (abs < 3_600_000) {
        const m = Math.round(abs / 60_000);
        return past ? `${m}m ago` : `in ${m}m`;
    }
    if (abs < 86_400_000) {
        const h = Math.round(abs / 3_600_000);
        return past ? `${h}h ago` : `in ${h}h`;
    }
    const d = Math.round(abs / 86_400_000);
    return past ? `${d}d ago` : `in ${d}d`;
}

function formatAllowedEnvs(allowed: string[] | null): string {
    if (!allowed || allowed.length === 0) return 'All environments';
    return allowed.join(', ');
}

export default function VaultCliTokensPanel({
    projectId,
    vaultEnvironments,
    isVaultAdmin,
    isMax,
    planCode,
    subscriptionPlanCode,
    subscriptionStatus,
    canManageBilling = false,
    addToast,
}: Props) {
    const { selectedWorkspaceId } = useAppContext();
    const billingMismatch = vaultBillingPlanMismatch(subscriptionPlanCode, planCode);
    const openPlanComparison = useOpenPlanComparisonModal(selectedWorkspaceId ?? undefined);
    const [tokens, setTokens] = useState<VaultCliToken[]>([]);
    const [loading, setLoading] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [revokeConfirm, setRevokeConfirm] = useState<VaultCliToken | null>(null);
    const [rotating, setRotating] = useState<string | null>(null);
    const [rotateConfirm, setRotateConfirm] = useState<VaultCliToken | null>(null);
    const [rotatedToken, setRotatedToken] = useState<VaultCliTokenWithPlaintext | null>(null);
    const [showUsage, setShowUsage] = useState(false);
    const migrationNoticeKey = `vault-cli-006-notice-${projectId}`;
    const [migrationNoticeDismissed, setMigrationNoticeDismissed] = useState(false);

    useEffect(() => {
        try {
            setMigrationNoticeDismissed(
                sessionStorage.getItem(migrationNoticeKey) === '1',
            );
        } catch {
            setMigrationNoticeDismissed(false);
        }
    }, [migrationNoticeKey]);

    const fetchTokens = useCallback(async () => {
        if (!isMax) {
            setTokens([]);
            return;
        }
        setLoading(true);
        try {
            const res = await authenticatedFetch(`/api/vault/cli-tokens?projectId=${projectId}`);
            const json = await res.json();
            if (!res.ok) {
                if (res.status === 403 && json.error === 'Upgrade required') {
                    setTokens([]);
                    return;
                }
                addToast(json.error ?? 'Failed to load tokens', 'error');
                return;
            }
            setTokens(json.data ?? []);
        } catch {
            addToast('Failed to load CLI tokens', 'error');
        } finally {
            setLoading(false);
        }
    }, [projectId, isMax, addToast]);

    useEffect(() => { fetchTokens(); }, [fetchTokens]);

    async function handleRevoke() {
        if (!revokeConfirm) return;
        setRevoking(revokeConfirm.id);
        try {
            const res = await authenticatedFetch('/api/vault/cli-tokens', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: revokeConfirm.id, projectId }),
            });
            const json = await res.json();
            if (!res.ok) { addToast(json.error ?? 'Revoke failed', 'error'); return; }
            addToast('Token revoked', 'warning');
            setRevokeConfirm(null);
            fetchTokens();
        } catch {
            addToast('Network error', 'error');
        } finally {
            setRevoking(null);
        }
    }

    async function handleRotate() {
        if (!rotateConfirm) return;
        setRotating(rotateConfirm.id);
        try {
            const res = await authenticatedFetch('/api/vault/cli-tokens/rotate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokenId: rotateConfirm.id, projectId }),
            });
            const json = await res.json();
            if (!res.ok) { addToast(json.error ?? 'Rotate failed', 'error'); return; }
            setRotateConfirm(null);
            setRotatedToken(json.data);
            fetchTokens();
        } catch {
            addToast('Network error', 'error');
        } finally {
            setRotating(null);
        }
    }

    const activeTokens = tokens.filter((t) => tokenStatus(t) === 'active');
    const inactiveTokens = tokens.filter((t) => tokenStatus(t) !== 'active');

    return (
        <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-text-muted">terminal</span>
                    <span className="text-sm font-medium text-text-primary">CLI Tokens</span>
                    <span className="text-xs text-text-muted bg-surface-dark-2 px-1.5 py-0.5 rounded border border-border-dark capitalize">
                        {formatVaultPlanLabel(planCode)}
                    </span>
                    {!isMax && (
                        <span className="text-xs text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
                            Requires Max
                        </span>
                    )}
                </div>
                {isMax && (
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowUsage(true)}
                            className="cursor-pointer flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
                            type="button"
                        >
                            <span className="material-symbols-outlined text-base">help</span>
                            CLI usage
                        </button>
                        <button
                            onClick={() => setShowCreate(true)}
                            className="cursor-pointer flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                            <span className="material-symbols-outlined text-base">add</span>
                            New Token
                        </button>
                    </div>
                )}
            </div>

            {isMax && !migrationNoticeDismissed && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-xs text-text-secondary">
                    <span className="material-symbols-outlined text-base text-blue-400 shrink-0">info</span>
                    <p className="flex-1">
                        CLI tokens were reset for security. Create a new token here if{' '}
                        <code className="text-text-primary">onework env</code> stopped working after the latest deploy.
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            try {
                                sessionStorage.setItem(migrationNoticeKey, '1');
                            } catch {
                                /* ignore */
                            }
                            setMigrationNoticeDismissed(true);
                        }}
                        className="shrink-0 text-text-muted hover:text-text-primary transition-colors"
                        aria-label="Dismiss"
                    >
                        <span className="material-symbols-outlined text-base">close</span>
                    </button>
                </div>
            )}

            {!isMax ? (
                <div className="bg-surface-dark border border-border-dark rounded-xl px-4 py-5 text-center">
                    <span className="material-symbols-outlined text-2xl text-text-muted opacity-40 mb-2 block">terminal</span>
                    {billingMismatch ? (
                        <>
                            <p className="text-sm text-text-secondary mb-1">CLI access needs billing attention</p>
                            <p className="text-xs text-text-muted mb-3">
                                This workspace is recorded as {formatVaultPlanLabel(subscriptionPlanCode)} (
                                {subscriptionStatus}), but vault is using {formatVaultPlanLabel(planCode)} limits.
                                Ensure the subscription is active or set status to manual for enterprise contracts.
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-text-secondary mb-1">Zero-trust CLI on Max and Enterprise</p>
                            <p className="text-xs text-text-muted mb-3">
                                Run local commands with vault secrets injected at runtime — nothing written to disk.
                                Generate personal CLI tokens and pull environment variables from the terminal.
                            </p>
                            {canManageBilling ? (
                                <button
                                    type="button"
                                    onClick={() =>
                                        openPlanComparison({
                                            note: 'Upgrade to Max to use the OneWork CLI with vault secrets.',
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
                                <p className="text-xs text-text-muted">Ask a workspace admin to upgrade to Max.</p>
                            )}
                        </>
                    )}
                </div>
            ) : loading ? (
                <div className="flex items-center justify-center h-16">
                    <span className="material-symbols-outlined animate-spin text-text-muted">progress_activity</span>
                </div>
            ) : tokens.length === 0 ? (
                <div className="bg-surface-dark border border-border-dark rounded-xl px-4 py-5 text-center">
                    <p className="text-sm text-text-secondary mb-1">No CLI tokens yet</p>
                    <p className="text-xs text-text-muted mb-3">
                        Generate a token to use the <code className="font-mono text-xs">onework</code> CLI on this project.
                    </p>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="cursor-pointer text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                        Generate your first token
                    </button>
                </div>
            ) : (
                <div className="bg-surface-dark border border-border-dark rounded-xl overflow-hidden divide-y divide-border-dark">
                    {[...activeTokens, ...inactiveTokens].map((token) => {
                        const status = tokenStatus(token);
                        return (
                            <div key={token.id} className="px-4 py-3 flex items-start gap-3 group">
                                <span className={`material-symbols-outlined text-base mt-0.5 shrink-0 ${
                                    status === 'active' ? 'text-emerald-400' : 'text-text-muted opacity-40'
                                }`}>
                                    key
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-sm font-medium truncate ${status !== 'active' ? 'text-text-muted line-through' : 'text-text-primary'}`}>
                                            {token.name}
                                        </span>
                                        {status !== 'active' && (
                                            <span className="text-xs text-text-muted bg-surface-dark-2 px-1.5 py-0.5 rounded border border-border-dark shrink-0">
                                                {status}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-text-muted">
                                        <span>Created {formatRelative(token.created_at)}</span>
                                        <span className={token.last_used_at ? 'text-emerald-400/90' : ''}>
                                            {token.last_used_at
                                                ? `Last used ${formatRelative(token.last_used_at)}`
                                                : 'Never used'}
                                        </span>
                                        {status === 'active' && (
                                            <span>Expires {formatRelative(token.expires_at)}</span>
                                        )}
                                    </div>
                                    <p className="mt-1 text-xs text-text-muted">
                                        Envs: {formatAllowedEnvs(token.allowed_environments)}
                                    </p>
                                </div>
                                {status === 'active' && (
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            onClick={() => setRotateConfirm(token)}
                                            disabled={rotating === token.id || revoking === token.id}
                                            title="Rotate token"
                                            className="cursor-pointer opacity-0 group-hover:opacity-100 px-2.5 py-1.5 text-xs text-text-muted border border-border-dark rounded-lg hover:text-blue-400 hover:border-blue-500/30 transition-all disabled:opacity-40"
                                        >
                                            Rotate
                                        </button>
                                        <button
                                            onClick={() => setRevokeConfirm(token)}
                                            disabled={revoking === token.id || rotating === token.id}
                                            title="Revoke token"
                                            className="cursor-pointer opacity-0 group-hover:opacity-100 px-2.5 py-1.5 text-xs text-text-muted border border-border-dark rounded-lg hover:text-red-400 hover:border-red-500/30 transition-all disabled:opacity-40"
                                        >
                                            Revoke
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {showCreate && (
                <CreateCliTokenModal
                    projectId={projectId}
                    vaultEnvironments={vaultEnvironments}
                    isVaultAdmin={isVaultAdmin}
                    onCreated={() => fetchTokens()}
                    onClose={() => setShowCreate(false)}
                    addToast={addToast}
                />
            )}

            {rotateConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-sm p-6 shadow-2xl">
                        <h3 className="text-base font-semibold text-text-primary mb-2">Rotate Token</h3>
                        <p className="text-sm text-text-secondary mb-5">
                            Issue a new token to replace <span className="font-medium text-text-primary">{rotateConfirm.name}</span>?
                            The old token will be revoked immediately and any CLI using it will stop working.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setRotateConfirm(null)}
                                className="cursor-pointer flex-1 px-4 py-2 rounded-lg border border-border-dark text-sm text-text-secondary hover:text-text-primary transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRotate}
                                disabled={!!rotating}
                                className="cursor-pointer flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                            >
                                {rotating ? 'Rotating…' : 'Rotate'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {rotatedToken && (
                <RevealTokenModal
                    token={rotatedToken}
                    projectId={projectId}
                    title="Copy Your New Token"
                    onClose={() => setRotatedToken(null)}
                />
            )}

            {showUsage && (
                <CliUsageModal
                    projectId={projectId}
                    onClose={() => setShowUsage(false)}
                />
            )}

            {revokeConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-sm p-6 shadow-2xl">
                        <h3 className="text-base font-semibold text-text-primary mb-2">Revoke Token</h3>
                        <p className="text-sm text-text-secondary mb-5">
                            Revoke <span className="font-medium text-text-primary">{revokeConfirm.name}</span>?
                            Any CLI using this token will stop working immediately.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setRevokeConfirm(null)}
                                className="cursor-pointer flex-1 px-4 py-2 rounded-lg border border-border-dark text-sm text-text-secondary hover:text-text-primary transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRevoke}
                                disabled={!!revoking}
                                className="cursor-pointer flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                            >
                                {revoking ? 'Revoking…' : 'Revoke'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
