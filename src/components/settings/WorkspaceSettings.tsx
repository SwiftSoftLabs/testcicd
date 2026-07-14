'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAppContext } from '@/context/AppContext';
import { Workspace } from '@/types';
import { useUIContext } from '@/context/UIContext';
import { api, ImpactResponse, WorkspaceMember } from '@/lib/api';
import DeleteImpactSummary from '@/components/settings/DeleteImpactSummary';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';
import { useCreateProjectGuard } from '@/hooks/useCreateProjectGuard';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type MemberData = Pick<WorkspaceMember, 'id' | 'role' | 'email' | 'name' | 'avatar' | 'status'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKSPACE_DELETE_NOTES = [
    'Only the workspace owner can delete a workspace.',
    'Members will lose access to this workspace. Their user accounts are not deleted.',
];
const PROJECT_DELETE_NOTES = [
    'Workspace owners and admins can delete projects.',
    'Workspace members keep access to the workspace.',
];

const WorkspaceSettings: React.FC = () => {
    const { can: canPerm } = useWorkspacePermissions();
    const {
        currentUser,
        selectedWorkspaceId,
        selectedProjectId,
        switchWorkspace,
        setSelectedWorkspaceId,
        setSelectedProjectId,
        refreshWorkspaces,
    } = useAppContext();
    const { openModal, updateModalProps } = useUIContext();
    const openCreateProject = useCreateProjectGuard();
    const searchParams = useSearchParams();
    const shouldOpenCreate = searchParams.get('create') === '1';

    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [projects, setProjects] = useState<Array<{ id: string; name: string; description?: string; status?: string; color?: string; quota_locked?: boolean }>>([]);
    const [members, setMembers] = useState<MemberData[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingProjects, setIsLoadingProjects] = useState(false);
    const [isLoadingMembers, setIsLoadingMembers] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isInviting, setIsInviting] = useState(false);
    const [isDeletingWorkspaceId, setIsDeletingWorkspaceId] = useState<string | null>(null);
    const [isDeletingProjectId, setIsDeletingProjectId] = useState<string | null>(null);
    const [newWorkspaceName, setNewWorkspaceName] = useState('');
    const [inviteEmail, setInviteEmail] = useState('');
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
    const projectColorRules = projects
        .map((project) => {
            const color = project.color || '#818cf8';
            return `[data-project-color="${project.id}"] { color: ${color}; background-color: color-mix(in srgb, ${color} 13%, transparent); }`;
        })
        .join('\n');

    const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    };

    const normalizeDeleteError = (scope: 'workspace' | 'project', error: unknown) => {
        const message = error instanceof Error ? error.message : 'Something went wrong.';
        if (message === 'Forbidden') {
            return scope === 'workspace'
                ? 'Only the workspace owner can delete this workspace.'
                : 'Only workspace owners and admins can delete projects.';
        }
        return message;
    };


    const buildDeleteImpactContent = (
        heading: string,
        notes: string[],
        data: ImpactResponse | null,
        loading = false,
        error?: string,
        onRetry?: () => void,
    ) => (
        <DeleteImpactSummary
            data={data}
            loading={loading}
            error={error}
            onRetry={onRetry}
            heading={heading}
            notes={notes}
        />
    );

    const loadDeleteImpact = async (
        scope: 'workspace' | 'project',
        targetId: string,
        modalInstanceId: string,
        notes: string[],
        fetchImpact: (id: string) => Promise<ImpactResponse>,
    ) => {
        updateModalProps({
            confirmDisabled: true,
            content: buildDeleteImpactContent('What will be deleted or removed', notes, null, true),
        }, modalInstanceId);

        try {
            const impactData = await fetchImpact(targetId);
            updateModalProps({
                confirmDisabled: false,
                content: buildDeleteImpactContent('What will be deleted or removed', notes, impactData),
            }, modalInstanceId);
        } catch (error: unknown) {
            const impactError = normalizeDeleteError(scope, error) || 'Could not load impact details.';
            updateModalProps({
                confirmDisabled: true,
                content: buildDeleteImpactContent(
                    'What will be deleted or removed',
                    notes,
                    null,
                    false,
                    impactError,
                    () => {
                        void loadDeleteImpact(scope, targetId, modalInstanceId, notes, fetchImpact);
                    },
                ),
            }, modalInstanceId);
        }
    };

    const executeWorkspaceDelete = async (workspaceId: string) => {
        setIsDeletingWorkspaceId(workspaceId);
        try {
            await api.workspaces.delete(workspaceId);
            const remaining = workspaces.filter((item) => item.id !== workspaceId);
            setWorkspaces(remaining);

            if (selectedWorkspaceId === workspaceId) {
                const nextWorkspaceId = remaining[0]?.id ?? null;
                if (nextWorkspaceId) {
                    switchWorkspace(nextWorkspaceId);
                } else {
                    setSelectedWorkspaceId(null);
                    setSelectedProjectId(null);
                }
            }

            await refreshWorkspaces();
            showToast('Workspace deleted.', 'success');
        } catch (error) {
            const message = normalizeDeleteError('workspace', error) || 'Failed to delete workspace.';
            showToast(message, 'error');
            throw new Error(message);
        } finally {
            setIsDeletingWorkspaceId(null);
        }
    };

    const REMOVE_MEMBER_NOTES = [
        'Workspace owners and admins can remove members.',
        'The user\'s account will not be deleted — they can still access other workspaces.',
        'Tasks assigned to this user in this workspace will become unassigned.',
    ];

    const executeProjectDelete = async (projectId: string) => {
        setIsDeletingProjectId(projectId);
        try {
            await api.projects.delete(projectId);
            const refreshedProjects = selectedWorkspaceId
                ? await api.projects.getAll(selectedWorkspaceId)
                : [];
            const remaining = Array.isArray(refreshedProjects)
                ? refreshedProjects
                : projects.filter((item) => item.id !== projectId);
            setProjects(remaining);

            if (selectedProjectId === projectId) {
                const nextProjectId = remaining[0]?.id ?? null;
                setSelectedProjectId(nextProjectId);
                const key = `ow-selected-project-id:${selectedWorkspaceId}`;
                if (nextProjectId) localStorage.setItem(key, nextProjectId);
                else localStorage.removeItem(key);
            }

            await refreshWorkspaces();
            showToast('Project deleted.', 'success');
        } catch (error) {
            const message = normalizeDeleteError('project', error) || 'Failed to delete project.';
            showToast(message, 'error');
            throw new Error(message);
        } finally {
            setIsDeletingProjectId(null);
        }
    };


    const fetchWorkspaces = useCallback(async () => {
        if (!currentUser?.id) {
            setIsLoading(false);
            return;
        }
        try {
            const res = await authenticatedFetch(`/api/workspace/me?userId=${currentUser.id}`);
            if (res.ok) {
                const { data } = await res.json();
                const list: Workspace[] = Array.isArray(data) ? data : (data ? [data] : []);
                setWorkspaces(list);
                if (!selectedWorkspaceId && list[0]?.id) {
                    switchWorkspace(list[0].id);
                }
            } else {
                setWorkspaces([]);
            }
        } catch {
            setWorkspaces([]);
        } finally {
            setIsLoading(false);
        }
    }, [currentUser?.id, selectedWorkspaceId, switchWorkspace]);

    const fetchMembers = useCallback(async (workspaceId: string) => {
        setIsLoadingMembers(true);
        try {
            const res = await authenticatedFetch(`/api/workspace/members?workspaceId=${workspaceId}&lite=true`);
            if (res.ok) {
                const { data } = await res.json();
                setMembers(data ?? []);
            }
        } catch {
            setMembers([]);
        } finally {
            setIsLoadingMembers(false);
        }
    }, []);

    const fetchProjects = useCallback(async (workspaceId: string) => {
        setIsLoadingProjects(true);
        try {
            const rows = await api.projects.getAll(workspaceId);
            setProjects(Array.isArray(rows) ? rows : []);
        } catch {
            setProjects([]);
        } finally {
            setIsLoadingProjects(false);
        }
    }, []);

    useEffect(() => {
        fetchWorkspaces();
    }, [fetchWorkspaces]);

    useEffect(() => {
        if (shouldOpenCreate) {
            setIsCreating(true);
        }
    }, [shouldOpenCreate]);

    useEffect(() => {
        if (selectedWorkspaceId) {
            fetchMembers(selectedWorkspaceId);
            fetchProjects(selectedWorkspaceId);
        } else {
            setMembers([]);
            setProjects([]);
        }
    }, [selectedWorkspaceId, fetchMembers, fetchProjects]);

    const handleCreateWorkspace = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newWorkspaceName.trim() || !currentUser) return;

        setIsSubmitting(true);
        try {
            const slug = `${newWorkspaceName.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
            const res = await authenticatedFetch('/api/workspace', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newWorkspaceName.trim(),
                    slug,
                    userId: currentUser.id,
                    userName: currentUser.name,
                    userEmail: currentUser.email,
                }),
            });

            const result = await res.json();

            if (!res.ok) {
                showToast(result.error || 'Failed to create workspace.', 'error');
            } else {
                showToast('Workspace created successfully!', 'success');
                const newWs: Workspace = { ...result.data, role: 'admin' };
                setWorkspaces((prev) => [...prev, newWs]);
                setIsCreating(false);
                setNewWorkspaceName('');
                if (result.data?.id) {
                    switchWorkspace(result.data.id);
                    await refreshWorkspaces();
                }
            }
        } catch {
            showToast('Network error. Make sure server is running.', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCreateProject = () => {
        if (!selectedWorkspaceId) {
            showToast('Select a workspace first.', 'error');
            return;
        }

        void openCreateProject({
            onCreated: (project: { id: string }) => {
                setSelectedProjectId(project.id);
                localStorage.setItem(`ow-selected-project-id:${selectedWorkspaceId}`, project.id);
                fetchProjects(selectedWorkspaceId);
                void refreshWorkspaces();
            },
        });
    };

    const handleDeleteWorkspace = async (workspaceId: string) => {
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (!workspaceId || !workspace || !UUID_RE.test(workspaceId)) {
            showToast('Invalid workspace selected for deletion.', 'error');
            return;
        }

        let modalInstanceId = '';

        modalInstanceId = openModal('confirm-action', {
            title: 'Permanently delete workspace?',
            ariaLabel: 'Delete workspace confirmation',
            message: `This will permanently delete "${workspace.name}" and everything inside it, including projects, tasks, and member access. This cannot be undone.`,
            content: buildDeleteImpactContent('What will be deleted or removed', WORKSPACE_DELETE_NOTES, null, true),
            confirmLabel: 'Delete workspace permanently',
            confirmInProgressLabel: 'Deleting workspace...',
            cancelLabel: 'Keep workspace',
            intent: 'danger',
            dismissible: false,
            requireTextMatch: workspace.name,
            confirmInputLabel: 'Type the workspace name to confirm',
            confirmDisabled: true,
            onConfirm: async () => executeWorkspaceDelete(workspaceId),
        });

        void loadDeleteImpact('workspace', workspaceId, modalInstanceId, WORKSPACE_DELETE_NOTES, api.workspaces.getDeleteImpact);
    };

    const handleDeleteProject = async (projectId: string) => {
        const project = projects.find((item) => item.id === projectId);
        if (!selectedWorkspaceId || !projectId || !project || !UUID_RE.test(projectId)) {
            showToast('Invalid project selected for deletion.', 'error');
            return;
        }
        if (!canPerm('delete_projects')) {
            showToast('You do not have permission to delete projects.', 'error');
            return;
        }
        const workspaceForProject = workspaces.find((item) => item.id === selectedWorkspaceId) ?? null;
        let modalInstanceId = '';

        modalInstanceId = openModal('confirm-action', {
            title: 'Permanently delete project?',
            ariaLabel: 'Delete project confirmation',
            message: `This will permanently delete "${project.name}" and its tasks from "${workspaceForProject?.name ?? 'this workspace'}". This cannot be undone.`,
            content: buildDeleteImpactContent('What will be deleted or removed', PROJECT_DELETE_NOTES, null, true),
            confirmLabel: 'Delete project permanently',
            confirmInProgressLabel: 'Deleting project...',
            cancelLabel: 'Keep project',
            intent: 'danger',
            dismissible: false,
            requireTextMatch: project.name,
            confirmInputLabel: 'Type the project name to confirm',
            confirmDisabled: true,
            onConfirm: async () => executeProjectDelete(projectId),
        });

        void loadDeleteImpact('project', projectId, modalInstanceId, PROJECT_DELETE_NOTES, api.projects.getDeleteImpact);
    };

    const handleRemoveMember = (memberId: string, memberName: string) => {
        if (!selectedWorkspaceId) return;

        let modalInstanceId = '';

        const executeRemove = async () => {
            await api.users.removeMember(memberId, selectedWorkspaceId);
            fetchMembers(selectedWorkspaceId);
            showToast(`${memberName} removed from workspace.`, 'success');
        };

        const loadImpact = async (instanceId: string) => {
            updateModalProps({
                confirmDisabled: true,
                content: buildDeleteImpactContent('What will be affected', REMOVE_MEMBER_NOTES, null, true),
            }, instanceId);
            try {
                const impactData = await api.users.getDeleteImpact(memberId, selectedWorkspaceId);
                updateModalProps({
                    confirmDisabled: false,
                    content: buildDeleteImpactContent('What will be affected', REMOVE_MEMBER_NOTES, impactData),
                }, instanceId);
            } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : 'Could not load impact details.';
                updateModalProps({
                    confirmDisabled: true,
                    content: buildDeleteImpactContent(
                        'What will be affected',
                        REMOVE_MEMBER_NOTES,
                        null,
                        false,
                        errMsg,
                        () => { void loadImpact(instanceId); },
                    ),
                }, instanceId);
            }
        };

        modalInstanceId = openModal('confirm-action', {
            title: 'Remove member from workspace?',
            ariaLabel: 'Remove member confirmation',
            message: `"${memberName}" will be removed from this workspace. Their tasks here will become unassigned. Their account will not be deleted.`,
            content: buildDeleteImpactContent('What will be affected', REMOVE_MEMBER_NOTES, null, true),
            confirmLabel: 'Remove member',
            confirmInProgressLabel: 'Removing...',
            cancelLabel: 'Cancel',
            intent: 'danger',
            dismissible: false,
            confirmDisabled: true,
            onConfirm: executeRemove,
        });

        void loadImpact(modalInstanceId);
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedWorkspaceId || !inviteEmail.trim()) return;

        setIsInviting(true);
        try {
            const res = await authenticatedFetch(`/api/workspace/members?workspaceId=${selectedWorkspaceId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: inviteEmail.trim(), role: 'member' }),
            });

            const result = await res.json();

            if (!res.ok) {
                showToast(result.error || 'Failed to add member.', 'error');
            } else {
                showToast(`${inviteEmail} successfully added!`, 'success');
                setInviteEmail('');
                fetchMembers(selectedWorkspaceId);
            }
        } catch {
            showToast('Network error.', 'error');
        } finally {
            setIsInviting(false);
        }
    };

    // ── Loading state ────────────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-16">
                <div className="flex flex-col items-center gap-4 text-text-secondary">
                    <div className="size-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm">Loading workspaces...</p>
                </div>
            </div>
        );
    }

    // ── Not logged in ─────────────────────────────────────────────────────────
    if (!currentUser?.id) {
        return (
            <div className="flex flex-col items-center justify-center p-12 bg-surface-dark border border-dashed border-border-dark rounded-2xl text-center gap-4">
                <span className="material-symbols-outlined text-4xl opacity-20">lock</span>
                <p className="opacity-50 font-bold uppercase tracking-widest text-xs">Login required</p>
                <p className="text-text-secondary text-sm">Please login to access Workspace Settings.</p>
            </div>
        );
    }

    const activeWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId) ?? workspaces[0] ?? null;
    const canDeleteProjects = canPerm('delete_projects');
    const canCreateProjects = canPerm('create_projects');
    const canInviteMembers = canPerm('invite_members');
    const canManageMembers = canPerm('manage_members');

    // ── No workspaces yet ────────────────────────────────────────────────────
    if (workspaces.length === 0) {
        if (isCreating) {
            return (
                <>
                    {toast && (
                        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg transition-all ${toast.type === 'success' ? 'bg-success text-white' : 'bg-red-500 text-white'}`}>
                            {toast.msg}
                        </div>
                    )}
                    <CreateWorkspaceForm
                        name={newWorkspaceName}
                        onNameChange={setNewWorkspaceName}
                        onSubmit={handleCreateWorkspace}
                        onCancel={() => setIsCreating(false)}
                        isSubmitting={isSubmitting}
                    />
                </>
            );
        }

        return (
            <div className="flex flex-col items-center justify-center p-12 bg-surface-dark border border-dashed border-border-dark rounded-2xl text-center gap-4">
                <div className="size-20 bg-primary/10 rounded-3xl flex items-center justify-center mb-2">
                    <span className="material-symbols-outlined text-4xl text-primary">workspaces</span>
                </div>
                <h3 className="text-xl font-bold text-main">No Workspace Yet</h3>
                <p className="text-text-secondary text-sm max-w-sm">
                    Create a workspace to start collaborating with your team and using Chat features.
                </p>
                <button
                    onClick={() => setIsCreating(true)}
                    className="cursor-pointer mt-4 px-6 py-3 bg-primary text-white rounded-xl font-bold hover:bg-blue-600 transition-all shadow-lg shadow-primary/20"
                >
                    + Create Workspace
                </button>
            </div>
        );
    }

    // ── Workspace list + members ─────────────────────────────────────────────
    return (
        <>
            {toast && (
                <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg transition-all ${toast.type === 'success' ? 'bg-success text-white' : 'bg-red-500 text-white'}`}>
                    {toast.msg}
                </div>
            )}
            <div className="min-w-0 max-w-full space-y-8">
                {/* Workspace List */}
                <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8">
                    <div className="mb-6 space-y-2">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 flex-wrap items-center gap-3">
                                <h3 className="text-lg font-bold text-main">Your Workspaces</h3>
                                <span className="bg-white/5 text-text-secondary text-[10px] font-black px-2 py-1 rounded-lg border border-border-dark uppercase tracking-widest whitespace-nowrap">
                                    {workspaces.length} {workspaces.length === 1 ? 'Workspace' : 'Workspaces'}
                                </span>
                            </div>
                            <button
                                onClick={() => setIsCreating((prev) => !prev)}
                                className="cursor-pointer px-4 py-2 bg-primary text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-all whitespace-nowrap"
                            >
                                {isCreating ? 'Cancel' : '+ Create Workspace'}
                            </button>
                        </div>
                        <p className="text-sm text-text-secondary">Manage your workspaces</p>
                    </div>

                    {/* Inline create form */}
                    {isCreating && (
                        <div className="mb-6">
                            <CreateWorkspaceForm
                                name={newWorkspaceName}
                                onNameChange={setNewWorkspaceName}
                                onSubmit={handleCreateWorkspace}
                                onCancel={() => { setIsCreating(false); setNewWorkspaceName(''); }}
                                isSubmitting={isSubmitting}
                                inline
                            />
                        </div>
                    )}

                    <div className="space-y-3">
                        {workspaces.map((ws) => {
                            const isActive = ws.id === (activeWorkspace?.id);
                            return (
                                <div
                                    key={ws.id}
                                    className={`flex flex-col gap-4 p-5 border rounded-2xl transition-all sm:flex-row sm:items-center sm:justify-between ${isActive
                                        ? 'bg-primary/5 border-primary/30'
                                        : 'bg-background-dark/30 border-border-dark hover:border-white/10'
                                        }`}
                                >
                                    <div className="flex min-w-0 items-center gap-4">
                                        <div className={`size-12 rounded-xl flex items-center justify-center ${isActive ? 'bg-primary/15 text-primary' : 'bg-white/5 text-text-secondary'}`}>
                                            <span className="material-symbols-outlined text-2xl">workspaces</span>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-bold text-main truncate">{ws.name}</p>
                                            <p className="text-xs font-mono text-text-secondary break-all">slug: {ws.slug}</p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                                        <span className="text-[10px] font-black text-text-secondary uppercase tracking-widest bg-white/5 px-2 py-1 rounded border border-border-dark">
                                            {ws.role ?? 'member'}
                                        </span>
                                        {isActive ? (
                                            <span className="px-3 py-1.5 bg-success/10 text-success text-xs font-black rounded-lg border border-success/20 uppercase tracking-widest">
                                                Active
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => switchWorkspace(ws.id)}
                                                className="cursor-pointer px-4 py-1.5 bg-white/5 text-main text-xs font-bold rounded-lg border border-border-dark hover:bg-white/10 transition-all"
                                            >
                                                Switch
                                            </button>
                                        )}
                                        {ws.owner_id === currentUser.id && (
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteWorkspace(ws.id)}
                                                disabled={!ws.id || isDeletingWorkspaceId === ws.id}
                                                className="cursor-pointer size-8 inline-flex items-center justify-center rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-all"
                                                title="Delete workspace"
                                                aria-label={`Delete workspace ${ws.name}`}
                                            >
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Projects — scoped to active workspace */}
                {activeWorkspace && (
                    <section id="projects" className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8">
                        <div className="mb-6 space-y-2">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 flex-wrap items-center gap-3">
                                    <h4 className="text-lg font-bold text-main">Your Projects</h4>
                                    <span className="bg-white/5 text-text-secondary text-[10px] font-black px-2 py-1 rounded-lg border border-border-dark uppercase tracking-widest whitespace-nowrap">
                                        {projects.length} {projects.length === 1 ? 'Project' : 'Projects'}
                                    </span>
                                </div>
                                {canCreateProjects && (
                                <button
                                    type="button"
                                    onClick={handleCreateProject}
                                    className="px-4 py-2 cursor-pointer bg-primary text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-all whitespace-nowrap"
                                >
                                    + Create Project
                                </button>
                                )}
                            </div>
                            <p className="text-sm text-text-secondary">Manage projects for the selected workspace</p>
                        </div>

                        {isLoadingProjects ? (
                            <div className="py-8 text-center text-text-secondary text-sm animate-pulse">Loading projects...</div>
                        ) : projects.length === 0 ? (
                            <div className="p-6 bg-background-dark border border-border-dark rounded-2xl text-center">
                                <p className="text-sm text-text-secondary">No projects in this workspace yet.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {projects.map((project) => (
                                    <div
                                        key={project.id}
                                        className="flex flex-col gap-4 p-5 bg-background-dark/30 border border-border-dark rounded-2xl hover:border-white/10 transition-all sm:flex-row sm:items-center sm:justify-between"
                                    >
                                        <div className="flex min-w-0 items-center gap-4">
                                            <div
                                                className="size-12 rounded-xl flex items-center justify-center project-color-chip shrink-0"
                                                data-project-color={project.id}
                                            >
                                                <span className="material-symbols-outlined text-2xl">folder</span>
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-main truncate">{project.name}</p>
                                                <p className="text-xs text-text-secondary break-words">
                                                    {project.quota_locked
                                                        ? 'Read-only due to plan limits'
                                                        : project.description?.trim() || project.status || 'No description'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                                            {project.quota_locked && (
                                                <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-300">
                                                    Read-only
                                                </span>
                                            )}
                                            {canCreateProjects && (
                                                <button
                                                    type="button"
                                                    onClick={() => openModal('edit-project', { project })}
                                                    className="cursor-pointer size-8 inline-flex items-center justify-center rounded-lg border border-border-dark text-text-secondary hover:text-main hover:bg-white/5 transition-all"
                                                    title="Edit project"
                                                    aria-label={`Edit project ${project.name}`}
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">edit</span>
                                                </button>
                                            )}
                                            {canDeleteProjects && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteProject(project.id)}
                                                    disabled={!project.id || isDeletingProjectId === project.id}
                                                    className="cursor-pointer size-8 inline-flex items-center justify-center rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-all"
                                                    title="Delete project"
                                                    aria-label={`Delete project ${project.name}`}
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {/* Members — scoped to active workspace */}
                {activeWorkspace && (
                    <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8">
                        <div className="mb-6 space-y-2">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 flex-wrap items-center gap-3">
                                    <h4 className="text-lg font-bold text-main">Members</h4>
                                    <span className="bg-white/5 text-text-secondary text-[10px] font-black px-2 py-1 rounded-lg border border-border-dark uppercase tracking-widest whitespace-nowrap">
                                        {members.length} {members.length === 1 ? 'Member' : 'Members'}
                                    </span>
                                </div>
                            </div>
                            <p className="text-sm text-text-secondary">Manage access for the selected workspace</p>
                        </div>

                        <div className="space-y-3 mb-8">
                            {isLoadingMembers ? (
                                <div className="py-8 text-center text-text-secondary text-sm animate-pulse">Loading members...</div>
                            ) : members.length === 0 ? (
                                <div className="py-8 text-center text-text-secondary text-sm">No members yet.</div>
                            ) : (
                                members.map((member) => (
                                    <div
                                        key={member.id}
                                        className="flex flex-col gap-3 p-4 bg-background-dark/30 border border-border-dark rounded-xl hover:border-white/10 transition-all sm:flex-row sm:items-center sm:justify-between"
                                    >
                                        <div className="flex min-w-0 items-center gap-4">
                                            <img
                                                src={member.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name || 'U')}&background=random`}
                                                className="size-10 shrink-0 rounded-lg border border-border-dark object-cover"
                                                alt=""
                                            />
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-main truncate">{member.name || 'Unknown User'}</p>
                                                <p className="text-xs text-text-secondary break-all">{member.email}</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                                            <span className="text-[10px] font-black text-text-secondary uppercase tracking-widest bg-white/5 px-2 py-1 rounded border border-border-dark">
                                                {member.role}
                                            </span>
                                            {canManageMembers && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveMember(member.id, member.name || member.email || 'this member')}
                                                    className="cursor-pointer size-8 inline-flex items-center justify-center rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-all"
                                                    title={`Remove ${member.name || member.email} from workspace`}
                                                    aria-label={`Remove ${member.name || member.email} from workspace`}
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">person_remove</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {canInviteMembers && (
                        <div data-tour="add-members-card" className="p-6 bg-background-dark border border-border-dark rounded-2xl">
                            <h5 className="text-sm font-bold text-main mb-4 flex items-center gap-2">
                                <span className="material-symbols-outlined text-[18px]">person_add</span>
                                Add Members
                            </h5>
                            <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
                                <input
                                    type="email"
                                    required
                                    value={inviteEmail}
                                    onChange={(e) => setInviteEmail(e.target.value)}
                                    placeholder="Enter email address"
                                    className="flex-1 bg-surface-dark border border-border-dark rounded-xl text-sm text-main px-4 py-2.5 focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all"
                                />
                                <button
                                    type="submit"
                                    disabled={isInviting || !inviteEmail.trim()}
                                    className="cursor-pointer px-6 py-2.5 bg-white text-background-dark rounded-xl font-bold hover:bg-gray-200 disabled:opacity-50 transition-all whitespace-nowrap"
                                >
                                    {isInviting ? 'Adding...' : 'Add'}
                                </button>
                            </form>
                            <p className="mt-3 text-[10px] text-text-secondary">
                                User must be registered on OneWork to be added.
                            </p>
                        </div>
                        )}
                    </section>
                )}
            </div>
            <style jsx>{`
                .project-color-chip {
                    color: #818cf8;
                    background-color: color-mix(in srgb, #818cf8 13%, transparent);
                }
            `}</style>
            <style jsx>{projectColorRules}</style>
        </>
    );
};

interface CreateWorkspaceFormProps {
    name: string;
    onNameChange: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    onCancel: () => void;
    isSubmitting: boolean;
    inline?: boolean;
}

const CreateWorkspaceForm: React.FC<CreateWorkspaceFormProps> = ({
    name, onNameChange, onSubmit, onCancel, isSubmitting, inline = false,
}) => (
    <div className={inline
        ? 'bg-background-dark border border-border-dark rounded-2xl p-6'
        : 'bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 animate-in slide-in-from-bottom-4 duration-300'
    }>
        {!inline && <h3 className="text-xl font-bold text-main mb-6">Create Workspace</h3>}
        <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
                <label className="text-xs font-bold text-text-secondary uppercase tracking-widest">
                    Workspace Name
                </label>
                <input
                    type="text"
                    required
                    autoFocus
                    data-tour="workspace-name-input"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="Example: Acme Corp, Engineering Team"
                    className="w-full bg-background-dark border border-border-dark rounded-xl text-main px-4 py-3 focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                />
            </div>
            <div className="flex items-center gap-3">
                <button
                    type="submit"
                    data-tour="create-workspace-submit"
                    disabled={isSubmitting || !name.trim()}
                    className="cursor-pointer px-6 py-2.5 bg-primary text-white rounded-xl font-bold hover:bg-blue-600 disabled:opacity-50 transition-all"
                >
                    {isSubmitting ? 'Creating...' : 'Create Workspace'}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="cursor-pointer px-6 py-2.5 bg-white/5 text-main rounded-xl font-bold hover:bg-white/10 transition-all"
                >
                    Cancel
                </button>
            </div>
        </form>
    </div>
);

export default WorkspaceSettings;
