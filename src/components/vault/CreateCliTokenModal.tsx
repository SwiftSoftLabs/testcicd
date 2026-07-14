'use client';

import { useState } from 'react';
import type { VaultCliTokenWithPlaintext, VaultEnvironment } from '@/types/vault';
import { isProtectedEnvName } from '@/lib/vault/env-policy';
import RevealTokenModal from './RevealTokenModal';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

const EXPIRY_PRESETS_MEMBER = [7, 30, 90] as const;
const EXPIRY_PRESETS_ADMIN = [7, 30, 90, 180, 365] as const;
const MAX_EXPIRES_MEMBER = 90;
const MAX_EXPIRES_ADMIN = 365;

interface Props {
    projectId: string;
    vaultEnvironments: VaultEnvironment[];
    isVaultAdmin: boolean;
    onCreated: () => void;
    onClose: () => void;
    addToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

export default function CreateCliTokenModal({
    projectId,
    vaultEnvironments,
    isVaultAdmin,
    onCreated,
    onClose,
    addToast,
}: Props) {
    const [name, setName] = useState('');
    const [expiresInDays, setExpiresInDays] = useState(30);
    const [selectedEnvs, setSelectedEnvs] = useState<Set<string>>(new Set());
    const [restrictEnvs, setRestrictEnvs] = useState(false);
    const [saving, setSaving] = useState(false);
    const [token, setToken] = useState<VaultCliTokenWithPlaintext | null>(null);

    const maxExpires = isVaultAdmin ? MAX_EXPIRES_ADMIN : MAX_EXPIRES_MEMBER;
    const presets = isVaultAdmin ? EXPIRY_PRESETS_ADMIN : EXPIRY_PRESETS_MEMBER;

    const visibleEnvironments = vaultEnvironments.filter(
        (env) => isVaultAdmin || !isProtectedEnvName(env.name),
    );

    function toggleEnv(envName: string) {
        setSelectedEnvs((prev) => {
            const next = new Set(prev);
            if (next.has(envName)) next.delete(envName);
            else next.add(envName);
            return next;
        });
    }

    async function handleCreate() {
        if (!name.trim()) return;
        setSaving(true);
        try {
            const allowedEnvironments =
                restrictEnvs && selectedEnvs.size > 0 ? Array.from(selectedEnvs) : undefined;

            const res = await authenticatedFetch('/api/vault/cli-tokens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    name: name.trim(),
                    expiresInDays: Math.min(expiresInDays, maxExpires),
                    allowedEnvironments,
                }),
            });
            const json = await res.json();
            if (res.status === 429) {
                addToast(json.error ?? 'Rate limit exceeded. Try again later.', 'warning');
                return;
            }
            if (!res.ok) {
                addToast(json.error ?? 'Failed to create token', 'error');
                return;
            }
            setToken(json.data);
        } catch {
            addToast('Network error', 'error');
        } finally {
            setSaving(false);
        }
    }

    function handleDone() {
        onCreated();
        onClose();
    }

    if (token) {
        return (
            <RevealTokenModal
                token={token}
                projectId={projectId}
                onClose={handleDone}
            />
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-dark">
                    <h3 className="text-sm font-semibold text-text-primary">New CLI Token</h3>
                    <button onClick={onClose} className="cursor-pointer text-text-muted hover:text-text-primary transition-colors">
                        <span className="material-symbols-outlined text-xl">close</span>
                    </button>
                </div>

                <div className="px-5 py-5 space-y-4">
                    <div>
                        <label className="block text-xs text-text-muted mb-1">Token name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. macbook-dev"
                            className="w-full bg-surface-dark-2 border border-border-dark rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
                            autoFocus
                        />
                        <p className="mt-2 text-xs text-text-muted">Use a device or environment name so you can recognize and revoke it later.</p>
                    </div>

                    {visibleEnvironments.length > 0 && (
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={restrictEnvs}
                                    onChange={(e) => setRestrictEnvs(e.target.checked)}
                                    className="rounded border-border-dark"
                                />
                                Restrict to specific environments
                            </label>
                            {restrictEnvs && (
                                <div className="flex flex-wrap gap-2 pl-1">
                                    {visibleEnvironments.map((env) => (
                                        <label
                                            key={env.id}
                                            className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedEnvs.has(env.name)}
                                                onChange={() => toggleEnv(env.name)}
                                                className="rounded border-border-dark"
                                            />
                                            {env.name}
                                        </label>
                                    ))}
                                </div>
                            )}
                            <p className="text-xs text-text-muted">
                                {restrictEnvs
                                    ? 'Token can only pull selected environments (recommended for CI).'
                                    : 'Unrestricted tokens can pull any environment your role allows.'}
                            </p>
                        </div>
                    )}

                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <label className="block text-xs text-text-muted">
                                Expires in{' '}
                                <span className="text-text-primary font-medium">
                                    {expiresInDays} day{expiresInDays !== 1 ? 's' : ''}
                                </span>
                            </label>
                            {expiresInDays >= 180 ? (
                                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300">
                                    Long-lived token
                                </span>
                            ) : null}
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                            {presets.map((days) => (
                                <button
                                    key={days}
                                    type="button"
                                    onClick={() => setExpiresInDays(days)}
                                    className={`cursor-pointer rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                                        expiresInDays === days
                                            ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                                            : 'border-border-dark bg-surface-dark-2 text-text-secondary hover:text-text-primary'
                                    }`}
                                >
                                    {days}d
                                </button>
                            ))}
                        </div>
                        <div className="space-y-2">
                            <label className="block text-xs text-text-muted" htmlFor="cli-token-expiry-days">
                                Custom duration (max {maxExpires}d)
                            </label>
                            <input
                                id="cli-token-expiry-days"
                                type="number"
                                min={1}
                                max={maxExpires}
                                step={1}
                                value={expiresInDays}
                                onChange={(e) => {
                                    const value = Number(e.target.value);
                                    if (Number.isNaN(value)) return;
                                    setExpiresInDays(Math.min(maxExpires, Math.max(1, Math.trunc(value))));
                                }}
                                className="w-full bg-surface-dark-2 border border-border-dark rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <p className="text-xs text-text-muted">
                            Use the shortest duration you need. Existing tokens without lookup were revoked — create a new token after this update.
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-between px-5 py-4 border-t border-border-dark">
                    <button
                        onClick={onClose}
                        className="cursor-pointer px-4 py-2 rounded-lg border border-border-dark text-sm text-text-secondary hover:text-text-primary transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={saving || !name.trim() || (restrictEnvs && selectedEnvs.size === 0)}
                        className="cursor-pointer px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                    >
                        {saving ? 'Generating…' : 'Generate Token'}
                    </button>
                </div>
            </div>
        </div>
    );
}
