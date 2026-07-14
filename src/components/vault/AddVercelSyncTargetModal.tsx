'use client';

import { useState, useEffect } from 'react';
import type { VaultEnvironment, VaultSyncTargetVercelConfig } from '@/types/vault';
import type { VercelProject } from '@/lib/integrations/vercel/types';
import type { VercelEnvTarget } from '@/lib/integrations/vercel/client';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface Props {
    projectId: string;
    workspaceId: string;
    vaultEnvironments: VaultEnvironment[];
    onSave: () => void;
    onClose: () => void;
    addToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

type Step = 'project' | 'vault-env' | 'variables';

const DEPLOY_TARGETS: { value: VercelEnvTarget; label: string }[] = [
    { value: 'production', label: 'Production' },
    { value: 'preview', label: 'Preview' },
    { value: 'development', label: 'Development' },
];

export default function AddVercelSyncTargetModal({
    projectId,
    workspaceId,
    vaultEnvironments,
    onSave,
    onClose,
    addToast,
}: Props) {
    const [step, setStep] = useState<Step>('project');
    const [name, setName] = useState('');

    // Step 1: Vercel project
    const [projects, setProjects] = useState<VercelProject[]>([]);
    const [projectsLoading, setProjectsLoading] = useState(true);
    const [projectSearch, setProjectSearch] = useState('');
    const [selectedProject, setSelectedProject] = useState<VercelProject | null>(null);

    // Step 2: Vault environment
    const [selectedVaultEnvId, setSelectedVaultEnvId] = useState<string>(vaultEnvironments[0]?.id ?? '');

    // Step 3: Deploy targets + variable mode
    const [deployTargets, setDeployTargets] = useState<Set<VercelEnvTarget>>(new Set(['production', 'preview']));
    const [variableMode, setVariableMode] = useState<'all' | 'subset'>('all');
    const [availableVars, setAvailableVars] = useState<{ id: string; name: string }[]>([]);
    const [varsLoading, setVarsLoading] = useState(false);
    const [selectedVarNames, setSelectedVarNames] = useState<Set<string>>(new Set());

    const [saving, setSaving] = useState(false);

    useEffect(() => {
        async function loadProjects() {
            setProjectsLoading(true);
            try {
                const res = await authenticatedFetch(`/api/integrations/vercel/projects?workspaceId=${workspaceId}`);
                const json = await res.json();
                if (!res.ok) { addToast(json.error ?? 'Failed to load Vercel projects', 'error'); return; }
                setProjects(json.data ?? []);
            } catch {
                addToast('Failed to load Vercel projects', 'error');
            } finally {
                setProjectsLoading(false);
            }
        }
        loadProjects();
    }, [workspaceId, addToast]);

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

    const filteredProjects = projects.filter((p) =>
        !projectSearch || p.name.toLowerCase().includes(projectSearch.toLowerCase())
    );

    function toggleDeployTarget(target: VercelEnvTarget) {
        setDeployTargets((prev) => {
            const next = new Set(prev);
            if (next.has(target)) next.delete(target);
            else next.add(target);
            return next;
        });
    }

    async function handleSave() {
        if (!selectedProject || !selectedVaultEnvId || deployTargets.size === 0) return;
        setSaving(true);
        try {
            const config: VaultSyncTargetVercelConfig = {
                provider: 'vercel',
                vercelProjectId: selectedProject.id,
                vercelProjectName: selectedProject.name,
                targets: Array.from(deployTargets),
                variableMode,
                selectedVariableNames: variableMode === 'subset' ? Array.from(selectedVarNames) : undefined,
                vaultEnvironmentId: selectedVaultEnvId,
            };
            const targetName = name.trim() || selectedProject.name;
            const res = await authenticatedFetch('/api/vault/sync-targets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, name: targetName, config }),
            });
            const json = await res.json();
            if (!res.ok) { addToast(json.error ?? 'Failed to create sync target', 'error'); return; }
            addToast('Vercel sync target created', 'success');
            onSave();
        } catch {
            addToast('Network error', 'error');
        } finally {
            setSaving(false);
        }
    }

    const canNext =
        (step === 'project' && selectedProject !== null) ||
        (step === 'vault-env' && selectedVaultEnvId !== '') ||
        (step === 'variables' && deployTargets.size > 0 && (variableMode === 'all' || selectedVarNames.size > 0));

    function nextStep() {
        if (step === 'project') setStep('vault-env');
        else if (step === 'vault-env') setStep('variables');
    }

    const stepLabels: Step[] = ['project', 'vault-env', 'variables'];
    const stepTitles: Record<Step, string> = {
        project: 'Select Vercel Project',
        'vault-env': 'Vault Environment',
        variables: 'Deploy Targets & Variables',
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-dark shrink-0">
                    <div>
                        <h3 className="text-sm font-semibold text-text-primary">Add Vercel Sync Target</h3>
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
                    {/* Step 1: Vercel project */}
                    {step === 'project' && (
                        <div className="space-y-3">
                            <input
                                type="text"
                                placeholder="Search projects…"
                                value={projectSearch}
                                onChange={(e) => setProjectSearch(e.target.value)}
                                className="w-full bg-surface-dark-2 border border-border-dark rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            {projectsLoading ? (
                                <div className="flex items-center justify-center h-24">
                                    <span className="material-symbols-outlined animate-spin text-text-muted">progress_activity</span>
                                </div>
                            ) : filteredProjects.length === 0 ? (
                                <p className="text-sm text-text-muted text-center py-6">
                                    {projects.length === 0 ? 'No Vercel projects found. Connect Vercel in Settings → Integrations.' : 'No projects match your search.'}
                                </p>
                            ) : (
                                <div className="space-y-1 max-h-60 overflow-y-auto">
                                    {filteredProjects.map((p) => (
                                        <button
                                            key={p.id}
                                            onClick={() => setSelectedProject(p)}
                                            className={`cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                                                selectedProject?.id === p.id
                                                    ? 'bg-blue-600/20 border border-blue-500/40'
                                                    : 'hover:bg-surface-dark-2 border border-transparent'
                                            }`}
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src="https://cdn.simpleicons.org/vercel/ffffff" alt="" className="size-4 shrink-0 opacity-60" />
                                            <div className="min-w-0">
                                                <span className="text-sm text-text-primary truncate block">{p.name}</span>
                                                {p.framework && (
                                                    <span className="text-xs text-text-muted">{p.framework}</span>
                                                )}
                                            </div>
                                            {selectedProject?.id === p.id && (
                                                <span className="material-symbols-outlined text-base text-blue-400 ml-auto shrink-0">check_circle</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 2: Vault environment */}
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

                    {/* Step 3: Deploy targets + variables */}
                    {step === 'variables' && (
                        <div className="space-y-4">
                            <div>
                                <p className="text-xs text-text-muted mb-2">Deploy environments to push to</p>
                                <div className="flex gap-2 flex-wrap">
                                    {DEPLOY_TARGETS.map(({ value, label }) => (
                                        <button
                                            key={value}
                                            onClick={() => toggleDeployTarget(value)}
                                            className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                                deployTargets.has(value)
                                                    ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                                                    : 'border-border-dark text-text-secondary hover:text-text-primary'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                {deployTargets.size === 0 && (
                                    <p className="text-xs text-amber-400 mt-1">Select at least one deploy target.</p>
                                )}
                            </div>

                            <div>
                                <p className="text-xs text-text-muted mb-2">Variables to sync</p>
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
                            </div>

                            {variableMode === 'subset' && (
                                <div className="space-y-1 max-h-40 overflow-y-auto">
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

                            <div>
                                <label className="block text-xs text-text-muted mb-1">Label (optional)</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder={selectedProject?.name ?? 'e.g. my-vercel-app'}
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
                            if (step === 'project') onClose();
                            else if (step === 'vault-env') setStep('project');
                            else setStep('vault-env');
                        }}
                        className="cursor-pointer px-4 py-2 rounded-lg border border-border-dark text-sm text-text-secondary hover:text-text-primary transition-colors"
                    >
                        {step === 'project' ? 'Cancel' : 'Back'}
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
