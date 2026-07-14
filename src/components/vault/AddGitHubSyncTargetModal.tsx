'use client';

import { useState, useEffect } from 'react';
import type { VaultEnvironment, VaultSyncTargetGithubConfig } from '@/types/vault';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface GitRepo {
    fullName: string;
    owner: string;
    name: string;
    private: boolean;
}

interface GitHubEnvironment {
    name: string;
}

interface Props {
    projectId: string;
    workspaceId: string;
    vaultEnvironments: VaultEnvironment[];
    onSave: () => void;
    onClose: () => void;
    addToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

type Step = 'repo' | 'environment' | 'vault-env' | 'variables';

export default function AddGitHubSyncTargetModal({
    projectId,
    workspaceId,
    vaultEnvironments,
    onSave,
    onClose,
    addToast,
}: Props) {
    const [step, setStep] = useState<Step>('repo');
    const [name, setName] = useState('');

    // Step 1: repo
    const [repos, setRepos] = useState<GitRepo[]>([]);
    const [reposLoading, setReposLoading] = useState(true);
    const [repoSearch, setRepoSearch] = useState('');
    const [selectedRepo, setSelectedRepo] = useState<GitRepo | null>(null);

    // Step 2: GitHub environment
    const [ghEnvironments, setGhEnvironments] = useState<GitHubEnvironment[]>([]);
    const [ghEnvLoading, setGhEnvLoading] = useState(false);
    const [selectedGhEnv, setSelectedGhEnv] = useState<string | null>(null); // null = repo-level

    // Step 3: vault environment
    const [selectedVaultEnvId, setSelectedVaultEnvId] = useState<string>(vaultEnvironments[0]?.id ?? '');

    // Step 4: variables
    const [variableMode, setVariableMode] = useState<'all' | 'subset'>('all');
    const [availableVars, setAvailableVars] = useState<{ id: string; name: string }[]>([]);
    const [varsLoading, setVarsLoading] = useState(false);
    const [selectedVarNames, setSelectedVarNames] = useState<Set<string>>(new Set());

    const [saving, setSaving] = useState(false);

    useEffect(() => {
        async function loadRepos() {
            setReposLoading(true);
            try {
                const res = await authenticatedFetch(`/api/integrations/git/github/repos?workspaceId=${workspaceId}&perPage=100`);
                const json = await res.json();
                if (!res.ok) { addToast(json.error ?? 'Failed to load repos', 'error'); return; }
                setRepos(json);
            } catch {
                addToast('Failed to load GitHub repos', 'error');
            } finally {
                setReposLoading(false);
            }
        }
        loadRepos();
    }, [workspaceId, addToast]);

    useEffect(() => {
        if (step !== 'environment' || !selectedRepo) return;
        async function loadEnvs() {
            if (!selectedRepo) return;
            setGhEnvLoading(true);
            try {
                const res = await fetch(
                    `/api/integrations/git/github/repos/${encodeURIComponent(selectedRepo.owner)}/${encodeURIComponent(selectedRepo.name)}/environments?workspaceId=${workspaceId}`
                );
                if (!res.ok) { setGhEnvironments([]); return; }
                const json = await res.json();
                setGhEnvironments(Array.isArray(json) ? json : json.environments ?? []);
            } catch {
                setGhEnvironments([]);
            } finally {
                setGhEnvLoading(false);
            }
        }
        loadEnvs();
    }, [step, selectedRepo, workspaceId]);

    useEffect(() => {
        if (step !== 'variables' || !selectedVaultEnvId) return;
        async function loadVars() {
            setVarsLoading(true);
            try {
                const res = await authenticatedFetch(`/api/vault/variables?projectId=${projectId}&environmentId=${selectedVaultEnvId}`);
                const json = await res.json();
                if (!res.ok) { addToast(json.error ?? 'Failed to load variables', 'error'); return; }
                setAvailableVars(json.data ?? []);
            } catch {
                addToast('Failed to load variables', 'error');
            } finally {
                setVarsLoading(false);
            }
        }
        loadVars();
    }, [step, selectedVaultEnvId, projectId, addToast]);

    const filteredRepos = repos.filter((r) =>
        !repoSearch || r.fullName.toLowerCase().includes(repoSearch.toLowerCase())
    );

    async function handleSave() {
        if (!selectedRepo || !selectedVaultEnvId) return;
        setSaving(true);
        try {
            const config: VaultSyncTargetGithubConfig = {
                provider: 'github',
                owner: selectedRepo.owner,
                repo: selectedRepo.name,
                environmentName: selectedGhEnv ?? null,
                variableMode,
                selectedVariableNames: variableMode === 'subset' ? Array.from(selectedVarNames) : undefined,
                vaultEnvironmentId: selectedVaultEnvId,
            };
            const targetName = name.trim() || `${selectedRepo.fullName}${selectedGhEnv ? ` (${selectedGhEnv})` : ''}`;
            const res = await authenticatedFetch('/api/vault/sync-targets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, name: targetName, config }),
            });
            const json = await res.json();
            if (!res.ok) { addToast(json.error ?? 'Failed to create sync target', 'error'); return; }
            addToast('Sync target created', 'success');
            onSave();
        } catch {
            addToast('Network error', 'error');
        } finally {
            setSaving(false);
        }
    }

    const canNext =
        (step === 'repo' && selectedRepo !== null) ||
        step === 'environment' ||
        (step === 'vault-env' && selectedVaultEnvId !== '') ||
        (step === 'variables' && (variableMode === 'all' || selectedVarNames.size > 0));

    function nextStep() {
        if (step === 'repo') setStep('environment');
        else if (step === 'environment') setStep('vault-env');
        else if (step === 'vault-env') setStep('variables');
    }

    const stepLabels: Step[] = ['repo', 'environment', 'vault-env', 'variables'];
    const stepTitles: Record<Step, string> = {
        repo: 'Select GitHub Repo',
        environment: 'GitHub Environment',
        'vault-env': 'Vault Environment',
        variables: 'Variables to Sync',
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-dark shrink-0">
                    <div>
                        <h3 className="text-sm font-semibold text-text-primary">Add GitHub Sync Target</h3>
                        <p className="text-xs text-text-muted mt-0.5">{stepTitles[step]}</p>
                    </div>
                    <button onClick={onClose} className="cursor-pointer text-text-muted hover:text-text-primary transition-colors">
                        <span className="material-symbols-outlined text-xl">close</span>
                    </button>
                </div>

                {/* Step indicators */}
                <div className="flex items-center gap-1 px-5 py-3 border-b border-border-dark shrink-0">
                    {stepLabels.map((s, i) => (
                        <div key={s} className="flex items-center gap-1">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                                s === step ? 'bg-blue-600 text-white' :
                                stepLabels.indexOf(step) > i ? 'bg-blue-600/30 text-blue-400' :
                                'bg-surface-dark-2 text-text-muted'
                            }`}>
                                {stepLabels.indexOf(step) > i
                                    ? <span className="material-symbols-outlined text-xs">check</span>
                                    : i + 1}
                            </div>
                            {i < stepLabels.length - 1 && (
                                <div className={`w-8 h-px ${stepLabels.indexOf(step) > i ? 'bg-blue-600/40' : 'bg-border-dark'}`} />
                            )}
                        </div>
                    ))}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {/* Step 1: Repo */}
                    {step === 'repo' && (
                        <div className="space-y-3">
                            <input
                                type="text"
                                placeholder="Search repos…"
                                value={repoSearch}
                                onChange={(e) => setRepoSearch(e.target.value)}
                                className="w-full bg-surface-dark-2 border border-border-dark rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            {reposLoading ? (
                                <div className="flex items-center justify-center h-24">
                                    <span className="material-symbols-outlined animate-spin text-text-muted">progress_activity</span>
                                </div>
                            ) : filteredRepos.length === 0 ? (
                                <p className="text-sm text-text-muted text-center py-6">
                                    {repos.length === 0 ? 'No GitHub repos found. Connect GitHub in Settings → Git & SSH.' : 'No repos match your search.'}
                                </p>
                            ) : (
                                <div className="space-y-1 max-h-60 overflow-y-auto">
                                    {filteredRepos.map((r) => (
                                        <button
                                            key={r.fullName}
                                            onClick={() => setSelectedRepo(r)}
                                            className={`cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                                                selectedRepo?.fullName === r.fullName
                                                    ? 'bg-blue-600/20 border border-blue-500/40'
                                                    : 'hover:bg-surface-dark-2 border border-transparent'
                                            }`}
                                        >
                                            <span className="material-symbols-outlined text-base text-text-muted shrink-0">
                                                {r.private ? 'lock' : 'public'}
                                            </span>
                                            <span className="text-sm text-text-primary truncate">{r.fullName}</span>
                                            {selectedRepo?.fullName === r.fullName && (
                                                <span className="material-symbols-outlined text-base text-blue-400 ml-auto shrink-0">check_circle</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 2: GitHub environment */}
                    {step === 'environment' && (
                        <div className="space-y-2">
                            <p className="text-xs text-text-muted mb-3">
                                Choose a GitHub Actions environment to scope secrets to, or push to repo-level (no environment).
                            </p>
                            {ghEnvLoading ? (
                                <div className="flex items-center justify-center h-16">
                                    <span className="material-symbols-outlined animate-spin text-text-muted">progress_activity</span>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <button
                                        onClick={() => setSelectedGhEnv(null)}
                                        className={`cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                                            selectedGhEnv === null
                                                ? 'bg-blue-600/20 border border-blue-500/40'
                                                : 'hover:bg-surface-dark-2 border border-transparent'
                                        }`}
                                    >
                                        <span className="material-symbols-outlined text-base text-text-muted shrink-0">storage</span>
                                        <div>
                                            <span className="text-sm text-text-primary">All variables (repo-level)</span>
                                            <p className="text-xs text-text-muted">No environment scope</p>
                                        </div>
                                        {selectedGhEnv === null && (
                                            <span className="material-symbols-outlined text-base text-blue-400 ml-auto shrink-0">check_circle</span>
                                        )}
                                    </button>
                                    {ghEnvironments.map((env) => (
                                        <button
                                            key={env.name}
                                            onClick={() => setSelectedGhEnv(env.name)}
                                            className={`cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                                                selectedGhEnv === env.name
                                                    ? 'bg-blue-600/20 border border-blue-500/40'
                                                    : 'hover:bg-surface-dark-2 border border-transparent'
                                            }`}
                                        >
                                            <span className="material-symbols-outlined text-base text-text-muted shrink-0">deployed_code</span>
                                            <span className="text-sm text-text-primary">{env.name}</span>
                                            {selectedGhEnv === env.name && (
                                                <span className="material-symbols-outlined text-base text-blue-400 ml-auto shrink-0">check_circle</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 3: Vault environment */}
                    {step === 'vault-env' && (
                        <div className="space-y-2">
                            <p className="text-xs text-text-muted mb-3">Choose which Vault environment to source variables from.</p>
                            {vaultEnvironments.map((env) => (
                                <button
                                    key={env.id}
                                    onClick={() => setSelectedVaultEnvId(env.id)}
                                    className={`cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                                        selectedVaultEnvId === env.id
                                            ? 'bg-blue-600/20 border border-blue-500/40'
                                            : 'hover:bg-surface-dark-2 border border-transparent'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-base text-text-muted shrink-0">
                                        {env.is_system ? 'lock' : 'folder'}
                                    </span>
                                    <span className="text-sm text-text-primary">{env.name}</span>
                                    {selectedVaultEnvId === env.id && (
                                        <span className="material-symbols-outlined text-base text-blue-400 ml-auto shrink-0">check_circle</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Step 4: Variables */}
                    {step === 'variables' && (
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setVariableMode('all')}
                                    className={`cursor-pointer flex-1 px-3 py-2 rounded-lg text-sm transition-colors border ${
                                        variableMode === 'all'
                                            ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                                            : 'border-border-dark text-text-secondary hover:text-text-primary'
                                    }`}
                                >
                                    All variables
                                </button>
                                <button
                                    onClick={() => setVariableMode('subset')}
                                    className={`cursor-pointer flex-1 px-3 py-2 rounded-lg text-sm transition-colors border ${
                                        variableMode === 'subset'
                                            ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                                            : 'border-border-dark text-text-secondary hover:text-text-primary'
                                    }`}
                                >
                                    Select specific
                                </button>
                            </div>

                            {variableMode === 'subset' && (
                                <div className="space-y-1 max-h-52 overflow-y-auto">
                                    {varsLoading ? (
                                        <div className="flex items-center justify-center h-16">
                                            <span className="material-symbols-outlined animate-spin text-text-muted">progress_activity</span>
                                        </div>
                                    ) : availableVars.length === 0 ? (
                                        <p className="text-sm text-text-muted text-center py-4">No variables in this environment.</p>
                                    ) : (
                                        availableVars.map((v) => (
                                            <label
                                                key={v.id}
                                                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-dark-2 cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedVarNames.has(v.name)}
                                                    onChange={(e) => {
                                                        const next = new Set(selectedVarNames);
                                                        if (e.target.checked) next.add(v.name);
                                                        else next.delete(v.name);
                                                        setSelectedVarNames(next);
                                                    }}
                                                    className="rounded border-border-dark"
                                                />
                                                <span className="font-mono text-sm text-text-primary">{v.name}</span>
                                            </label>
                                        ))
                                    )}
                                </div>
                            )}

                            {/* Optional name */}
                            <div className="pt-2">
                                <label className="block text-xs text-text-muted mb-1">Label (optional)</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder={selectedRepo ? `${selectedRepo.fullName}${selectedGhEnv ? ` (${selectedGhEnv})` : ''}` : 'e.g. production-repo'}
                                    className="w-full bg-surface-dark-2 border border-border-dark rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-border-dark shrink-0">
                    <button
                        onClick={() => {
                            if (step === 'repo') onClose();
                            else if (step === 'environment') setStep('repo');
                            else if (step === 'vault-env') setStep('environment');
                            else setStep('vault-env');
                        }}
                        className="cursor-pointer px-4 py-2 rounded-lg border border-border-dark text-sm text-text-secondary hover:text-text-primary transition-colors"
                    >
                        {step === 'repo' ? 'Cancel' : 'Back'}
                    </button>
                    {step === 'variables' ? (
                        <button
                            onClick={handleSave}
                            disabled={saving || !canNext}
                            className="cursor-pointer px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                        >
                            {saving ? 'Saving…' : 'Add Sync Target'}
                        </button>
                    ) : (
                        <button
                            onClick={nextStep}
                            disabled={!canNext}
                            className="cursor-pointer px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                        >
                            Next
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
