'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useAppContext } from '@/context/AppContext';
import { useUIContext } from '@/context/UIContext';
import ProjectScopeSelect from '@/components/ProjectScopeSelect';
import { usePageProjectScope } from '@/hooks/usePageProjectScope';
import VaultVariableModal from '@/components/vault/VaultVariableModal';
import VaultImportModal from '@/components/vault/VaultImportModal';
import VaultSyncTargetsPanel from '@/components/vault/VaultSyncTargetsPanel';
import VaultCliTokensPanel from '@/components/vault/VaultCliTokensPanel';
import VaultUnavailableState from '@/components/vault/VaultUnavailableState';
import { VAULT_MASK } from '@/types/vault';
import { isProtectedEnvName } from '@/lib/vault/env-policy';
import type { VaultErrorCode } from '@/lib/vault/api-errors';
import { VAULT_ERROR_CODES } from '@/lib/vault/api-errors';
import { vaultHasMax, vaultHasPro } from '@/lib/vault/plan-tier';
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import type {
    VaultSummary,
    VaultVariableMeta,
    VaultEnvironment,
    VaultAuditEntry,
} from '@/types/vault';
import VaultMfaGate from '@/components/security/VaultMfaGate';
import VaultVariableName from '@/components/vault/VaultVariableName';
import { formatVaultVariableName } from '@/lib/vault/variable-names';

function VaultPageInner() {
    const { projects, selectedWorkspaceId, setSelectedProjectId, canWorkspace, projectsSettled } = useAppContext();
    const { addToast } = useUIContext();
    const { selectedProjectId, setProjectId } = usePageProjectScope(projects, {
        storageKey: selectedWorkspaceId ? `ow-selected-project-id:${selectedWorkspaceId}` : null,
        onProjectChange: setSelectedProjectId,
    });

    const [summary, setSummary] = useState<VaultSummary | null>(null);
    const [loadError, setLoadError] = useState<{
        message: string;
        code?: VaultErrorCode;
        detail?: string;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeEnvId, setActiveEnvId] = useState<string | null>(null);
    const [variables, setVariables] = useState<VaultVariableMeta[]>([]);
    const [varLoading, setVarLoading] = useState(false);
    const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});
    const revealTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const [showAddVar, setShowAddVar] = useState(false);
    const [editingVar, setEditingVar] = useState<VaultVariableMeta | null>(null);
    const [showImport, setShowImport] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<VaultVariableMeta | null>(null);
    const [deleting, setDeleting] = useState(false);

    const [showAddEnv, setShowAddEnv] = useState(false);
    const [newEnvName, setNewEnvName] = useState('');
    const [savingEnv, setSavingEnv] = useState(false);
    const [deleteEnvConfirm, setDeleteEnvConfirm] = useState<VaultEnvironment | null>(null);

    const [auditLog, setAuditLog] = useState<VaultAuditEntry[]>([]);
    const [auditLoading, setAuditLoading] = useState(false);
    const [showAudit, setShowAudit] = useState(false);
    const [auditCursor, setAuditCursor] = useState<string | null>(null);

    const [revealing, setRevealing] = useState<string | null>(null);
    const [copying, setCopying] = useState<string | null>(null);
    const variablesRequestRef = useRef(0);
    const summaryRequestRef = useRef(0);

    const fetchSummary = useCallback(async (projectId: string, requestId: number) => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await authenticatedFetch(`/api/vault/summary?projectId=${projectId}`);
            const json = await res.json();
            if (requestId !== summaryRequestRef.current) return;
            if (!res.ok) {
                setSummary(null);
                const code = json.code as VaultErrorCode | undefined;
                setLoadError({
                    message: json.error ?? 'Failed to load Vault',
                    code,
                    detail: typeof json.detail === 'string' ? json.detail : undefined,
                });
                const isSetupError =
                    code === VAULT_ERROR_CODES.NOT_CONFIGURED ||
                    code === VAULT_ERROR_CODES.KEY_MISMATCH ||
                    code === VAULT_ERROR_CODES.SCHEMA_MISSING;
                if (!isSetupError) {
                    addToast(json.error ?? 'Failed to load Vault', 'error');
                }
                return;
            }
            setLoadError(null);
            setSummary(json.data);
            const envs = json.data.environments as VaultEnvironment[];
            if (envs.length === 0) {
                setActiveEnvId(null);
            } else {
                setActiveEnvId((prev) =>
                    prev && envs.some((e) => e.id === prev) ? prev : envs[0].id
                );
            }
        } catch {
            if (requestId !== summaryRequestRef.current) return;
            setSummary(null);
            setLoadError({ message: 'Failed to load Vault' });
            addToast('Failed to load Vault', 'error');
        } finally {
            if (requestId === summaryRequestRef.current) {
                setLoading(false);
            }
        }
    }, [addToast]);

    const reloadSummary = useCallback(() => {
        if (!selectedProjectId) return;
        const requestId = ++summaryRequestRef.current;
        fetchSummary(selectedProjectId, requestId);
    }, [selectedProjectId, fetchSummary]);

    const fetchVariables = useCallback(async (projectId: string, envId: string, requestId: number) => {
        setVarLoading(true);
        try {
            const res = await authenticatedFetch(`/api/vault/variables?projectId=${projectId}&environmentId=${envId}`);
            const json = await res.json();
            if (requestId !== variablesRequestRef.current) return;
            if (!res.ok) {
                if (res.status === 404) {
                    setVariables([]);
                    return;
                }
                addToast(json.error ?? 'Failed to load variables', 'error');
                return;
            }
            setVariables(json.data);
        } catch {
            if (requestId !== variablesRequestRef.current) return;
            addToast('Failed to load variables', 'error');
        } finally {
            if (requestId === variablesRequestRef.current) {
                setVarLoading(false);
            }
        }
    }, [addToast]);

    useEffect(() => {
        summaryRequestRef.current += 1;
        variablesRequestRef.current += 1;
        setSummary(null);
        setLoadError(null);
        setActiveEnvId(null);
        setVariables([]);
        setRevealedValues({});
        setLoading(true);
    }, [selectedWorkspaceId]);

    useEffect(() => {
        variablesRequestRef.current += 1;
        setActiveEnvId(null);
        setVariables([]);
        setRevealedValues({});
        if (!selectedProjectId) {
            setLoading(!projectsSettled);
            return;
        }
        const requestId = ++summaryRequestRef.current;
        fetchSummary(selectedProjectId, requestId);
    }, [selectedProjectId, projectsSettled, fetchSummary]);

    useEffect(() => {
        if (!selectedProjectId || !activeEnvId || !summary) {
            return;
        }
        if (!summary.environments.some((e) => e.id === activeEnvId)) {
            return;
        }
        const requestId = ++variablesRequestRef.current;
        fetchVariables(selectedProjectId, activeEnvId, requestId);
    }, [selectedProjectId, activeEnvId, summary, fetchVariables]);

    function scheduleRevealClear(variableId: string) {
        if (revealTimers.current[variableId]) clearTimeout(revealTimers.current[variableId]);
        revealTimers.current[variableId] = setTimeout(() => {
            setRevealedValues((prev) => { const next = { ...prev }; delete next[variableId]; return next; });
        }, 15_000);
    }

    async function handleReveal(v: VaultVariableMeta) {
        if (!selectedProjectId) return;
        if (revealedValues[v.id]) {
            setRevealedValues((prev) => { const next = { ...prev }; delete next[v.id]; return next; });
            return;
        }
        setRevealing(v.id);
        try {
            const res = await authenticatedFetch('/api/vault/reveal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: selectedProjectId, variableId: v.id }),
            });
            const json = await res.json();
            if (!res.ok) { addToast(json.error ?? 'Reveal failed', 'error'); return; }
            setRevealedValues((prev) => ({ ...prev, [v.id]: json.data.value }));
            scheduleRevealClear(v.id);
        } catch {
            addToast('Network error', 'error');
        } finally {
            setRevealing(null);
        }
    }

    async function handleCopy(v: VaultVariableMeta) {
        if (!selectedProjectId) return;
        setCopying(v.id);
        try {
            const res = await authenticatedFetch('/api/vault/reveal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: selectedProjectId, variableId: v.id }),
            });
            const json = await res.json();
            if (!res.ok) { addToast(json.error ?? 'Failed to copy', 'error'); return; }
            await navigator.clipboard.writeText(json.data.value);
            addToast(`Copied ${formatVaultVariableName(v.name)}`, 'success');
        } catch {
            addToast('Network error', 'error');
        } finally {
            setCopying(null);
        }
    }

    async function handleDelete() {
        if (!deleteConfirm || !selectedProjectId) return;
        setDeleting(true);
        try {
            const res = await authenticatedFetch('/api/vault/variables', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: deleteConfirm.id,
                    projectId: selectedProjectId,
                    updatedAt: deleteConfirm.updated_at,
                }),
            });
            const json = await res.json();
            if (!res.ok) {
                addToast(json.error ?? 'Delete failed', res.status === 409 ? 'warning' : 'error');
                return;
            }
            setVariables((prev) => prev.filter((v) => v.id !== deleteConfirm.id));
            setSummary((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    environments: prev.environments.map((e) =>
                        e.id === activeEnvId ? { ...e, variable_count: e.variable_count - 1 } : e
                    ),
                    totalVariables: prev.totalVariables - 1,
                };
            });
            setDeleteConfirm(null);
            addToast('Variable deleted', 'success');
        } catch {
            addToast('Network error', 'error');
        } finally {
            setDeleting(false);
        }
    }

    async function handleAddEnvironment() {
        if (!selectedProjectId || !newEnvName.trim()) return;
        setSavingEnv(true);
        try {
            const res = await authenticatedFetch('/api/vault/environments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: selectedProjectId, name: newEnvName.trim() }),
            });
            const json = await res.json();
            if (!res.ok) { addToast(json.error ?? 'Failed to create environment', 'error'); return; }
            addToast('Environment created', 'success');
            setNewEnvName('');
            setShowAddEnv(false);
            reloadSummary();
        } catch {
            addToast('Network error', 'error');
        } finally {
            setSavingEnv(false);
        }
    }

    async function handleDeleteEnvironment() {
        if (!deleteEnvConfirm || !selectedProjectId) return;
        try {
            const res = await authenticatedFetch('/api/vault/environments', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: deleteEnvConfirm.id, projectId: selectedProjectId }),
            });
            const json = await res.json();
            if (!res.ok) { addToast(json.error ?? 'Failed to delete environment', 'error'); return; }
            addToast('Environment deleted', 'success');
            setDeleteEnvConfirm(null);
            if (activeEnvId === deleteEnvConfirm.id) setActiveEnvId(null);
            reloadSummary();
        } catch {
            addToast('Network error', 'error');
        }
    }

    async function fetchAuditLog(cursor?: string) {
        if (!selectedProjectId) return;
        setAuditLoading(true);
        try {
            const params = new URLSearchParams({ projectId: selectedProjectId, limit: '50' });
            if (cursor) params.set('before', cursor);
            const res = await authenticatedFetch(`/api/vault/audit?${params}`);
            const json = await res.json();
            if (!res.ok) { addToast(json.error ?? 'Failed to load audit log', 'error'); return; }
            if (cursor) {
                setAuditLog((prev) => [...prev, ...json.data]);
            } else {
                setAuditLog(json.data);
            }
            setAuditCursor(json.nextCursor);
        } catch {
            addToast('Failed to load audit log', 'error');
        } finally {
            setAuditLoading(false);
        }
    }

    function handleToggleAudit() {
        if (!showAudit) fetchAuditLog();
        setShowAudit((v) => !v);
    }

    const projectsLoading = Boolean(selectedWorkspaceId) && !projectsSettled;

    if (!selectedProjectId) {
        if (projectsLoading) {
            return (
                <div className="flex items-center justify-center h-64">
                    <span className="material-symbols-outlined animate-spin text-text-muted text-3xl">progress_activity</span>
                </div>
            );
        }
        return (
            <div className="flex flex-col items-center justify-center h-64 text-text-muted gap-3">
                <span className="material-symbols-outlined text-3xl opacity-40">security</span>
                <p className="text-sm">Select a project to manage its Vault</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <span className="material-symbols-outlined animate-spin text-text-muted text-3xl">progress_activity</span>
            </div>
        );
    }

    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    const projectLabel = selectedProject?.name ?? selectedProjectId ?? undefined;

    if (
        loadError?.code === VAULT_ERROR_CODES.NOT_CONFIGURED ||
        loadError?.code === VAULT_ERROR_CODES.KEY_MISMATCH ||
        loadError?.code === VAULT_ERROR_CODES.SCHEMA_MISSING
    ) {
        return (
            <>
                <div className="p-6 pb-0 w-full">
                    <ProjectScopeSelect
                        projects={projects}
                        selectedProjectId={selectedProjectId}
                        onChange={setProjectId}
                        className="w-[260px]"
                    />
                </div>
                <VaultUnavailableState
                    code={loadError.code}
                    message={loadError.message}
                    detail={loadError.detail}
                    projectName={projectLabel}
                    onRetry={reloadSummary}
                />
            </>
        );
    }

    if (loadError) {
        return (
            <div className="w-full p-6">
                <div className="mb-4">
                    <ProjectScopeSelect
                        projects={projects}
                        selectedProjectId={selectedProjectId}
                        onChange={setProjectId}
                        className="w-[260px]"
                    />
                </div>
                <div className="max-w-2xl mx-auto bg-surface-dark border border-border-dark rounded-xl px-6 py-8 text-center">
                    <span className="material-symbols-outlined text-3xl text-text-muted opacity-50">error</span>
                    <p className="text-sm text-text-primary mt-3">{loadError.message}</p>
                    <button
                        type="button"
                        onClick={reloadSummary}
                        className="mt-4 text-sm text-blue-400 hover:text-blue-300"
                    >
                        Try again
                    </button>
                </div>
            </div>
        );
    }

    const activeEnv = summary?.environments.find((e) => e.id === activeEnvId);
    const isAdmin = summary?.isAdmin ?? false;
    // Members can write/reveal non-production envs; production stays admin-only.
    const canWriteActiveEnv = !!activeEnv && (isAdmin || !isProtectedEnvName(activeEnv.name));
    const limits = summary?.limits;
    const isLockedProject = selectedProject?.quota_locked === true;
    const atEnvLimit = limits && summary ? summary.environments.length >= limits.maxEnvironments : false;

    return (
        <div className="p-6 w-full min-w-0">
            {/* Project selector */}
            <div className="mb-4">
                <ProjectScopeSelect
                    projects={projects}
                    selectedProjectId={selectedProjectId}
                    onChange={setProjectId}
                    className="w-[260px]"
                />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-2xl text-text-muted">security</span>
                    <div>
                        <h1 className="text-lg font-semibold text-text-primary">Environment Vault</h1>
                        <p className="text-xs text-text-muted">
                            {summary?.totalVariables ?? 0} variable{summary?.totalVariables !== 1 ? 's' : ''} across {summary?.environments.length ?? 0} environment{summary?.environments.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {canWriteActiveEnv && !isLockedProject && (
                        <>
                            <button
                                onClick={() => setShowImport(true)}
                                className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary border border-border-dark rounded-lg hover:text-text-primary hover:border-border-dark-hover transition-colors"
                            >
                                <span className="material-symbols-outlined text-sm">upload</span>
                                Import .env
                            </button>
                            <button
                                onClick={() => setShowAddVar(true)}
                                className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                            >
                                <span className="material-symbols-outlined text-sm">add</span>
                                Add Variable
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="flex gap-6">
                {/* Environment sidebar */}
                <div className="w-52 shrink-0">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Environments</span>
                        {isAdmin && !isLockedProject && (
                            <button
                                onClick={() => {
                                    if (atEnvLimit) {
                                        addToast(`Environment limit reached (${limits?.maxEnvironments}). Upgrade to add more.`, 'warning');
                                    } else {
                                        setShowAddEnv(true);
                                    }
                                }}
                                title={atEnvLimit ? `Limit: ${limits?.maxEnvironments} environments` : 'Add environment'}
                                className={`text-text-muted hover:text-text-primary transition-colors ${atEnvLimit ? 'opacity-40 cursor-not-allowed' : ''}`}
                            >
                                <span className="material-symbols-outlined text-base">add</span>
                            </button>
                        )}
                    </div>

                    <div className="space-y-0.5">
                        {summary?.environments.map((env) => (
                            <div
                                key={env.id}
                                className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                                    activeEnvId === env.id
                                        ? 'bg-blue-600/20 text-blue-400'
                                        : 'text-text-secondary hover:bg-surface-dark-2 hover:text-text-primary'
                                }`}
                                onClick={() => setActiveEnvId(env.id)}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="material-symbols-outlined text-sm shrink-0">
                                        {env.is_system ? 'lock' : 'folder'}
                                    </span>
                                    <span className="text-xs truncate">{env.name}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="text-xs text-text-muted">{env.variable_count}</span>
                                    {isAdmin && !isLockedProject && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); if (!env.is_system) setDeleteEnvConfirm(env); }}
                                            className={`cursor-pointer transition-all text-text-muted ${!env.is_system ? 'opacity-0 group-hover:opacity-100 hover:text-red-400' : 'invisible'}`}
                                        >
                                            <span className="material-symbols-outlined text-sm">delete</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {showAddEnv && (
                        <div className="mt-3 space-y-2">
                            <input
                                type="text"
                                value={newEnvName}
                                onChange={(e) => setNewEnvName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleAddEnvironment(); if (e.key === 'Escape') { setShowAddEnv(false); setNewEnvName(''); } }}
                                placeholder="staging"
                                autoFocus
                                className="w-full bg-surface-dark-2 border border-border-dark rounded-lg px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setShowAddEnv(false); setNewEnvName(''); }}
                                    className="cursor-pointer flex-1 text-xs text-text-muted hover:text-text-primary transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddEnvironment}
                                    disabled={savingEnv || !newEnvName.trim()}
                                    className="cursor-pointer flex-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors"
                                >
                                    {savingEnv ? 'Saving…' : 'Create'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Variables panel */}
                <div className="flex-1 min-w-0">
                    {activeEnv ? (
                        <div className="bg-surface-dark border border-border-dark rounded-xl overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-border-dark">
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-sm text-text-muted">
                                        {activeEnv.is_system ? 'lock' : 'folder'}
                                    </span>
                                    <span className="text-sm font-medium text-text-primary">{activeEnv.name}</span>
                                    {activeEnv.is_system && (
                                        <span className="text-xs text-text-muted bg-surface-dark-2 px-1.5 py-0.5 rounded">system</span>
                                    )}
                                </div>
                                <span className="text-xs text-text-muted">
                                    {variables.length} / {limits?.maxVariables} variables
                                </span>
                            </div>

                            {varLoading ? (
                                <div className="flex items-center justify-center h-32">
                                    <span className="material-symbols-outlined animate-spin text-text-muted">progress_activity</span>
                                </div>
                            ) : variables.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-40 text-text-muted gap-3">
                                    <span className="material-symbols-outlined text-3xl opacity-40">key</span>
                                    <p className="text-sm">No variables yet</p>
                                    {canWriteActiveEnv && !isLockedProject && (
                                        <button
                                            onClick={() => setShowAddVar(true)}
                                            className="cursor-pointer text-xs text-blue-400 hover:text-blue-300 transition-colors"
                                        >
                                            Add the first variable
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="divide-y divide-border-dark">
                                    {variables.map((v) => (
                                        <div key={v.id} className="flex items-center gap-4 px-4 py-3 group hover:bg-surface-dark-2/50 transition-colors">
                                            <VaultVariableName name={v.name} />
                                            <span className="font-mono text-sm text-text-muted flex-1 tracking-widest select-none">
                                                {revealedValues[v.id] ?? VAULT_MASK}
                                            </span>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {canWriteActiveEnv && (
                                                    <>
                                                        <button
                                                            onClick={() => handleReveal(v)}
                                                            disabled={revealing === v.id}
                                                            title={revealedValues[v.id] ? 'Hide value' : 'Reveal value'}
                                                            className="p-1.5 text-text-muted hover:text-blue-400 transition-colors rounded-md hover:bg-surface-dark-2 cursor-pointer disabled:cursor-not-allowed"
                                                        >
                                                            <span className="material-symbols-outlined text-base">
                                                                {revealedValues[v.id] ? 'visibility_off' : 'visibility'}
                                                            </span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleCopy(v)}
                                                            disabled={copying === v.id}
                                                            title="Copy value to clipboard"
                                                            className="p-1.5 text-text-muted hover:text-green-400 transition-colors rounded-md hover:bg-surface-dark-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                                                        >
                                                            <span className="material-symbols-outlined text-base">
                                                                {copying === v.id ? 'progress_activity' : 'content_copy'}
                                                            </span>
                                                        </button>
                                                    </>
                                                )}
                                                {canWriteActiveEnv && !isLockedProject && (
                                                    <>
                                                        <button
                                                            onClick={() => setEditingVar(v)}
                                                            title="Edit value"
                                                            className="p-1.5 text-text-muted hover:text-yellow-400 transition-colors rounded-md hover:bg-surface-dark-2 cursor-pointer"
                                                        >
                                                            <span className="material-symbols-outlined text-base">edit</span>
                                                        </button>
                                                        <button
                                                            onClick={() => setDeleteConfirm(v)}
                                                            title="Delete variable"
                                                            className="p-1.5 text-text-muted hover:text-red-400 transition-colors rounded-md hover:bg-surface-dark-2 cursor-pointer"
                                                        >
                                                            <span className="material-symbols-outlined text-base">delete</span>
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-surface-dark border border-border-dark rounded-xl overflow-hidden">
                            <div className="flex items-center justify-center h-48 text-text-muted text-sm px-4 text-center">
                                {summary && summary.environments.length === 0
                                    ? 'No environments yet. An admin can add one from the sidebar.'
                                    : 'Select an environment to view variables.'}
                            </div>
                        </div>
                    )}


                    {/* Sync targets + CLI — only after summary matches current project */}
                    {summary && selectedWorkspaceId && (
                        <VaultSyncTargetsPanel
                            projectId={selectedProjectId}
                            workspaceId={selectedWorkspaceId}
                            vaultEnvironments={summary.environments}
                            isPro={vaultHasPro(summary.planCode)}
                            isVaultAdmin={summary.isAdmin}
                            planCode={summary.planCode}
                            subscriptionPlanCode={summary.subscriptionPlanCode}
                            subscriptionStatus={summary.subscriptionStatus}
                            canManageBilling={canWorkspace('billing_management')}
                            addToast={addToast}
                        />
                    )}

                    {summary && (
                        <VaultCliTokensPanel
                            projectId={selectedProjectId}
                            vaultEnvironments={summary.environments}
                            isVaultAdmin={summary.isAdmin}
                            isMax={vaultHasMax(summary.planCode)}
                            planCode={summary.planCode}
                            subscriptionPlanCode={summary.subscriptionPlanCode}
                            subscriptionStatus={summary.subscriptionStatus}
                            canManageBilling={canWorkspace('billing_management')}
                            addToast={addToast}
                        />
                    )}


                    {/* Audit log (admin only) */}
                    {isAdmin && (
                        <div className="mt-4">
                            <button
                                onClick={handleToggleAudit}
                                className="cursor-pointer flex items-center gap-2 text-xs text-text-muted hover:text-text-primary transition-colors"
                            >
                                <span className="material-symbols-outlined text-base">
                                    {showAudit ? 'expand_less' : 'expand_more'}
                                </span>
                                Audit Log
                            </button>

                            {showAudit && (
                                <div className="mt-3 bg-surface-dark border border-border-dark rounded-xl overflow-hidden">
                                    <div className="px-4 py-3 border-b border-border-dark">
                                        <span className="text-sm font-medium text-text-primary">Vault Activity</span>
                                    </div>
                                    {auditLoading && auditLog.length === 0 ? (
                                        <div className="flex items-center justify-center h-24">
                                            <span className="material-symbols-outlined animate-spin text-text-muted">progress_activity</span>
                                        </div>
                                    ) : auditLog.length === 0 ? (
                                        <div className="flex items-center justify-center h-24 text-text-muted text-xs">
                                            No activity yet.
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-border-dark max-h-64 overflow-y-auto">
                                            {auditLog.map((entry) => (
                                                <div key={entry.id} className="px-4 py-2.5 flex items-start gap-3">
                                                    <span className="material-symbols-outlined text-sm text-text-muted mt-0.5 shrink-0">history</span>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-medium text-text-secondary">{entry.event_type}</span>
                                                            <span className="text-xs text-text-muted truncate">
                                                                {entry.actor_name ?? entry.actor_email ?? entry.actor_id}
                                                            </span>
                                                        </div>
                                                        <span className="text-xs text-text-muted">
                                                            {new Date(entry.created_at).toLocaleString()}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {auditCursor && (
                                        <div className="px-4 py-3 border-t border-border-dark">
                                            <button
                                                onClick={() => fetchAuditLog(auditCursor)}
                                                disabled={auditLoading}
                                                className="cursor-pointer text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors"
                                            >
                                                Load more
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            {(showAddVar || editingVar) && activeEnvId && (
                <VaultVariableModal
                    projectId={selectedProjectId}
                    environmentId={activeEnvId}
                    initialVar={editingVar ?? undefined}
                    addToast={addToast}
                    onSave={(saved) => {
                        setVariables((prev) => {
                            const idx = prev.findIndex((v) => v.id === saved.id);
                            if (idx >= 0) {
                                const next = [...prev];
                                next[idx] = saved;
                                return next;
                            }
                            return [...prev, saved];
                        });
                        if (!editingVar) {
                            setSummary((prev) => prev ? {
                                ...prev,
                                environments: prev.environments.map((e) =>
                                    e.id === activeEnvId ? { ...e, variable_count: e.variable_count + 1 } : e
                                ),
                                totalVariables: prev.totalVariables + 1,
                            } : prev);
                        }
                        setShowAddVar(false);
                        setEditingVar(null);
                    }}
                    onClose={() => { setShowAddVar(false); setEditingVar(null); }}
                />
            )}

            {showImport && activeEnvId && activeEnv && (
                <VaultImportModal
                    projectId={selectedProjectId}
                    environmentId={activeEnvId}
                    environmentName={activeEnv.name}
                    addToast={addToast}
                    onImport={(imported, overwritten) => {
                        setShowImport(false);
                        fetchVariables(selectedProjectId, activeEnvId, ++variablesRequestRef.current);
                        setSummary((prev) => prev ? {
                            ...prev,
                            environments: prev.environments.map((e) =>
                                e.id === activeEnvId ? { ...e, variable_count: e.variable_count + imported } : e
                            ),
                            totalVariables: prev.totalVariables + imported,
                        } : prev);
                    }}
                    onClose={() => setShowImport(false)}
                />
            )}

            {/* Delete variable confirmation */}
            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-sm p-6 shadow-2xl">
                        <h3 className="text-base font-semibold text-text-primary mb-2">Delete Variable</h3>
                        <p className="text-sm text-text-secondary mb-5">
                            Delete <span className="font-mono text-red-400">{formatVaultVariableName(deleteConfirm.name)}</span>? This action cannot be undone.
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
                                {deleting ? 'Deleting…' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete environment confirmation */}
            {deleteEnvConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-surface-dark border border-border-dark rounded-xl w-full max-w-sm p-6 shadow-2xl">
                        <h3 className="text-base font-semibold text-text-primary mb-2">Delete Environment</h3>
                        <p className="text-sm text-text-secondary mb-5">
                            Delete the <span className="font-medium text-text-primary">{deleteEnvConfirm.name}</span> environment? All variables inside will also be deleted.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteEnvConfirm(null)}
                                className="cursor-pointer flex-1 px-4 py-2 rounded-lg border border-border-dark text-sm text-text-secondary hover:text-text-primary transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteEnvironment}
                                className="cursor-pointer flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function VaultPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center h-64">
                <span className="material-symbols-outlined animate-spin text-text-muted text-3xl">progress_activity</span>
            </div>
        }>
            <VaultMfaGate>
                <VaultPageInner />
            </VaultMfaGate>
        </Suspense>
    );
}
