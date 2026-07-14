'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useUIContext } from '@/context/UIContext';
import { useAppContext } from '@/context/AppContext';
import { api, WorkspaceMember, ImpactResponse } from '@/lib/api';
import DeleteImpactSummary from '@/components/settings/DeleteImpactSummary';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';

const UserManagementSettings = () => {
    const { addToast, openModal, updateModalProps } = useUIContext();
    const { selectedWorkspaceId, currentUser } = useAppContext();
    const { can } = useWorkspacePermissions();
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState('All Roles');
    const [statusFilter, setStatusFilter] = useState('All Status');
    const [sortBy, setSortBy] = useState('Newest');
    const [isFilterVisible, setIsFilterVisible] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 5;

    const [users, setUsers]       = useState<WorkspaceMember[]>([]);
    const [total, setTotal]       = useState(0);
    const [statsData, setStatsData] = useState({ totalMembers: 0, totalActive: 0, totalAdmins: 0 });
    const [isLoading, setIsLoading] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Debounce search input 300ms
    useEffect(() => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = setTimeout(() => {
            setDebouncedSearch(searchQuery);
            setCurrentPage(1);
        }, 300);
        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    }, [searchQuery]);

    const fetchMembers = useCallback(async () => {
        if (!selectedWorkspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedWorkspaceId)) return;
        setIsLoading(true);
        try {
            const result = await api.users.getMembers(selectedWorkspaceId, {
                search: debouncedSearch,
                role:   roleFilter !== 'All Roles'    ? roleFilter   : undefined,
                status: statusFilter !== 'All Status' ? statusFilter : undefined,
                sort:   sortBy,
                page:   currentPage,
                limit:  itemsPerPage,
            });
            setUsers(result.data);
            setTotal(result.total);
            setStatsData({
                totalMembers: result.totalMembers,
                totalActive:  result.totalActive,
                totalAdmins:  result.totalAdmins,
            });
        } catch (err) {
            addToast('Failed to load users.', 'error');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }, [selectedWorkspaceId, debouncedSearch, roleFilter, statusFilter, sortBy, currentPage, addToast]);

    useEffect(() => {
        fetchMembers();
    }, [fetchMembers, refreshKey]);

    const totalPages   = Math.ceil(total / itemsPerPage);
    const currentUsers = users;

    const stats = useMemo(() => [
        { label: 'Total Users', value: String(statsData.totalMembers), icon: 'group' },
        { label: 'Active Now',  value: String(statsData.totalActive),  icon: 'check_circle', color: 'text-emerald-400' },
        { label: 'Admins',      value: String(statsData.totalAdmins),  icon: 'security',     color: 'text-purple-400' }
    ], [statsData]);

    const handleRoleChange = async (userId: string, nextRole: string) => {
        if (!selectedWorkspaceId) return;
        try {
            await api.users.updateMemberRole(userId, selectedWorkspaceId, nextRole);
            setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: nextRole } : u)));
            addToast('Role updated.', 'success');
        } catch (err: unknown) {
            addToast(err instanceof Error ? err.message : 'Failed to update role.', 'error');
        }
    };

    const handleInvite = () => {
        openModal('invite-user', {
            onInviteSuccess: () => {
                setRefreshKey(prev => prev + 1);
                setCurrentPage(1);
            },
        });
    };

    const handleToggleStatus = async (id: string) => {
        const user = users.find(u => u.id === id);
        if (!user || !selectedWorkspaceId) return;
        const nextStatus = user.status === 'Active' ? 'Offline' : 'Active';
        setUsers(prev => prev.map(u => u.id === id ? { ...u, status: nextStatus } : u));
        try {
            await api.users.updateStatus(id, nextStatus, selectedWorkspaceId);
            addToast(`${user.name} status updated.`, 'info');
        } catch {
            setUsers(prev => prev.map(u => u.id === id ? { ...u, status: user.status } : u));
            addToast('Failed to update status.', 'error');
        }
    };

    const DELETE_USER_NOTES = [
        'The user will be removed from this workspace only.',
        'They can still log in and access their other workspaces.',
        'All tasks assigned to this user in this workspace will become unassigned.',
    ];

    const buildDeleteImpactContent = (
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
            heading="What will be affected"
            notes={DELETE_USER_NOTES}
        />
    );

    const handleDeleteUser = (userId: string, userName: string) => {
        if (!selectedWorkspaceId) return;

        let modalInstanceId = '';

        const executeDelete = async () => {
            await api.users.removeMember(userId, selectedWorkspaceId);
            setRefreshKey(prev => prev + 1);
            setCurrentPage(1);
            addToast(`${userName} has been removed from this workspace.`, 'success');
        };

        const loadImpact = async (instanceId: string) => {
            updateModalProps({ confirmDisabled: true, content: buildDeleteImpactContent(null, true) }, instanceId);
            try {
                const impactData = await api.users.getDeleteImpact(userId, selectedWorkspaceId);
                updateModalProps({ confirmDisabled: false, content: buildDeleteImpactContent(impactData) }, instanceId);
            } catch (err: unknown) {
                const errMsg = err instanceof Error ? err.message : 'Could not load impact details.';
                updateModalProps({
                    confirmDisabled: true,
                    content: buildDeleteImpactContent(null, false, errMsg, () => { void loadImpact(instanceId); }),
                }, instanceId);
            }
        };

        modalInstanceId = openModal('confirm-action', {
            title: 'Remove member from workspace?',
            ariaLabel: 'Remove member confirmation',
            message: `This will remove "${userName}" from this workspace. Their assigned tasks here will become unassigned. They can still access any other workspaces they belong to.`,
            content: buildDeleteImpactContent(null, true),
            confirmLabel: 'Remove from workspace',
            confirmInProgressLabel: 'Removing member...',
            cancelLabel: 'Cancel',
            intent: 'danger',
            dismissible: false,
            requireTextMatch: userName,
            confirmInputLabel: 'Type the user\'s name to confirm',
            confirmDisabled: true,
            onConfirm: executeDelete,
        });

        void loadImpact(modalInstanceId);
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-white tracking-tight">User Management</h2>
                    <p className="text-text-secondary text-sm">Manage team members, roles, and access permissions for your workspace.</p>
                </div>
                {can('invite_members') && (
                    <button onClick={handleInvite} data-tour="invite-user-btn" className="cursor-pointer bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg shadow-primary/20 transition-all active:scale-95">
                        <span className="material-symbols-outlined text-sm">person_add</span> Invite User
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6">
                {stats.map((s, idx) => (
                    <div key={idx} className="bg-surface-dark border border-border-dark p-4 lg:p-6 rounded-2xl flex items-center gap-4 hover:border-white/10 transition-all group">
                        <div className={`size-12 rounded-xl bg-background-dark border border-border-dark flex items-center justify-center transition-colors ${s.color || 'text-primary'}`}>
                            <span className="material-symbols-outlined text-2xl">{s.icon}</span>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">{s.label}</p>
                            <h3 className="text-2xl font-black text-white">{s.value}</h3>
                        </div>
                    </div>
                ))}
            </div>

            <section className="bg-surface-dark border border-border-dark rounded-2xl overflow-hidden shadow-sm flex flex-col">
                <div className="p-4 border-b border-border-dark flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-white/[0.01]">
                    <div className="relative w-full sm:flex-1 group">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-sm group-focus-within:text-primary transition-colors">search</span>
                        <input
                            type="text"
                            placeholder="Type to quick search users..."
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); }}
                            className="w-full bg-background-dark border-border-dark rounded-xl pl-9 pr-8 py-2 text-xs text-white focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-text-secondary/50"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => { setSearchQuery(''); setCurrentPage(1); }}
                                className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-white flex items-center justify-center"
                            >
                                <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                        )}
                    </div>
                    <div className="flex w-full sm:w-auto items-center gap-2">
                        <div className="hidden sm:block text-[10px] text-text-secondary font-medium mr-2 whitespace-nowrap">
                            {total} member{total !== 1 ? 's' : ''} found
                        </div>
                        <select
                            value={sortBy}
                            onChange={(e) => { setSortBy(e.target.value); setCurrentPage(1); }}
                            className="flex-1 sm:flex-none bg-background-dark border-border-dark rounded-xl text-[10px] font-bold text-text-secondary uppercase tracking-widest px-3 py-2 outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                        >
                            <option>Newest</option>
                            <option>Alphabetical (A-Z)</option>
                            <option>Alphabetical (Z-A)</option>
                        </select>
                        <button
                            onClick={() => setIsFilterVisible(!isFilterVisible)}
                            className={`cursor-pointer p-2 border rounded-xl transition-all relative ${isFilterVisible || roleFilter !== 'All Roles' || statusFilter !== 'All Status' ? 'bg-primary/20 border-primary text-primary' : 'bg-background-dark border-border-dark text-text-secondary hover:text-white'}`}
                            title="Advanced Filters"
                        >
                            <span className="material-symbols-outlined text-sm">filter_list</span>
                            {(roleFilter !== 'All Roles' || statusFilter !== 'All Status') && (
                                <span className="absolute -top-1 -right-1 size-2.5 bg-primary rounded-full border-[1.5px] border-surface-dark"></span>
                            )}
                        </button>
                    </div>
                </div>

                {isFilterVisible && (
                    <div className="px-4 py-3 bg-background-dark/50 border-b border-border-dark flex flex-wrap items-center gap-4 animate-in slide-in-from-top-1 duration-200">
                        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
                            <label className="text-[10px] font-black text-text-secondary uppercase tracking-widest">Filter by Role</label>
                            <select
                                value={roleFilter}
                                onChange={(e) => { setRoleFilter(e.target.value); setCurrentPage(1); }}
                                className="bg-surface-dark border-border-dark rounded-lg text-xs py-1.5 px-3 text-white focus:ring-primary outline-none"
                            >
                                <option>All Roles</option>
                                <option>Admin</option>
                                <option>Team Lead</option>
                                <option>Member</option>
                                <option>Guest</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
                            <label className="text-[10px] font-black text-text-secondary uppercase tracking-widest">Filter by Status</label>
                            <select
                                value={statusFilter}
                                onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                                className="bg-surface-dark border-border-dark rounded-lg text-xs py-1.5 px-3 text-white focus:ring-primary outline-none"
                            >
                                <option>All Status</option>
                                <option>Active</option>
                                <option>Away</option>
                                <option>Offline</option>
                                <option>Do not disturb</option>
                                <option>Invited</option>
                            </select>
                        </div>
                        <div className="flex items-end h-full mt-auto">
                            <button
                                onClick={() => { setSearchQuery(''); setRoleFilter('All Roles'); setStatusFilter('All Status'); setSortBy('Newest'); setIsFilterVisible(false); }}
                                className="cursor-pointer text-[10px] font-bold text-text-secondary hover:text-white mb-[2px] uppercase tracking-widest px-3 py-1.5 rounded-lg border border-border-dark hover:bg-white/5 transition-colors"
                            >
                                Reset Filters
                            </button>
                        </div>
                    </div>
                )}

                {/* Active Filter Badges */}
                {(roleFilter !== 'All Roles' || statusFilter !== 'All Status') && (
                    <div className="px-4 py-2 border-b border-border-dark bg-background-dark/50 flex flex-wrap items-center gap-2 animate-in fade-in duration-200">
                        <span className="text-[10px] font-medium text-text-secondary mr-1">Active Filters:</span>
                        {roleFilter !== 'All Roles' && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 border border-border-dark rounded-md group hover:border-white/20 transition-all">
                                <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Role:</span>
                                <span className="text-[10px] font-medium text-white">{roleFilter}</span>
                                <button onClick={() => { setRoleFilter('All Roles'); setCurrentPage(1); }} className="cursor-pointer text-text-secondary hover:text-red-400 flex items-center justify-center transition-colors">
                                    <span className="material-symbols-outlined text-[12px]">close</span>
                                </button>
                            </div>
                        )}
                        {statusFilter !== 'All Status' && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 border border-border-dark rounded-md group hover:border-white/20 transition-all">
                                <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Status:</span>
                                <span className="text-[10px] font-medium text-white">{statusFilter}</span>
                                <button onClick={() => { setStatusFilter('All Status'); setCurrentPage(1); }} className="cursor-pointer text-text-secondary hover:text-red-400 flex items-center justify-center transition-colors">
                                    <span className="material-symbols-outlined text-[12px]">close</span>
                                </button>
                            </div>
                        )}
                        <button onClick={() => { setRoleFilter('All Roles'); setStatusFilter('All Status'); setCurrentPage(1); }} className="cursor-pointer text-[10px] font-bold text-primary hover:text-primary/80 ml-2 transition-colors">Clear all</button>
                    </div>
                )}

                <div className="w-full bg-surface-dark border-b border-border-dark/50">
                    {/* Desktop Header */}
                    <div className="hidden xl:grid grid-cols-[25%_15%_20%_minmax(0,1fr)_120px] bg-background-dark/30 border-b border-border-dark">
                        <div className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">User</div>
                        <div className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">Role</div>
                        <div className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">Status & Activity</div>
                        <div className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">Active Projects</div>
                        <div className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] text-right">Actions</div>
                    </div>

                    {/* Body */}
                    <div className="divide-y divide-border-dark">
                        {isLoading && currentUsers.length === 0 ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="flex flex-col xl:grid xl:grid-cols-[25%_15%_20%_minmax(0,1fr)_120px] xl:items-center p-4 xl:p-0 gap-4 xl:gap-0 animate-pulse">
                                    <div className="xl:px-6 xl:py-4 flex items-center gap-4">
                                        <div className="size-12 xl:size-10 rounded-full bg-white/5 shrink-0"></div>
                                        <div className="space-y-2 flex-1">
                                            <div className="h-3 bg-white/5 rounded w-3/4"></div>
                                            <div className="h-2 bg-white/5 rounded w-1/2"></div>
                                        </div>
                                    </div>
                                    <div className="hidden xl:flex xl:px-6 xl:py-4"><div className="h-5 bg-white/5 rounded w-16"></div></div>
                                    <div className="hidden xl:flex xl:px-6 xl:py-4"><div className="h-4 bg-white/5 rounded w-20"></div></div>
                                    <div className="hidden xl:flex xl:px-6 xl:py-4 gap-1.5">
                                        <div className="h-5 bg-white/5 rounded w-20"></div>
                                    </div>
                                    <div className="hidden xl:flex xl:px-6 xl:py-4 justify-end"><div className="h-7 bg-white/5 rounded w-16"></div></div>
                                </div>
                            ))
                        ) : (
                            currentUsers.map((u) => (
                                <div key={u.id} className="flex flex-col xl:grid xl:grid-cols-[25%_15%_20%_minmax(0,1fr)_120px] xl:items-center hover:bg-white/[0.02] transition-all group cursor-pointer p-4 xl:p-0 gap-4 xl:gap-0" onClick={() => handleToggleStatus(u.id)}>
                                    {/* User Info */}
                                    <div className="xl:px-6 xl:py-4 flex flex-row xl:flex-col items-center xl:items-start gap-4 xl:gap-3">
                                        <div className="relative shrink-0">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={u.avatar} className="size-12 xl:size-10 rounded-full border border-border-dark shadow-sm group-hover:scale-105 transition-transform object-cover" alt="" />
                                            {u.status === 'Active' && <span className="absolute -bottom-0.5 -right-0.5 size-3 bg-emerald-500 border-2 border-surface-dark rounded-full animate-pulse"></span>}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-white group-hover:text-primary transition-colors">{u.name}</p>
                                            <p className="text-[10px] text-text-secondary">{u.email}</p>
                                        </div>
                                    </div>

                                    {/* Responsive Grid for Stats on Mobile/Tablet */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:contents">
                                        <div className="xl:px-6 xl:py-4 flex flex-col gap-1 xl:gap-0 xl:justify-center">
                                            <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest xl:hidden">Role</span>
                                            {can('manage_members') && u.id !== currentUser?.id ? (
                                                <select
                                                    value={u.role}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onChange={(e) => {
                                                        e.stopPropagation();
                                                        void handleRoleChange(u.id, e.target.value);
                                                    }}
                                                    className="px-2 py-1 rounded-lg bg-background-dark border border-border-dark text-[10px] font-bold text-text-secondary uppercase tracking-widest w-fit cursor-pointer outline-none focus:ring-1 focus:ring-primary"
                                                >
                                                    <option>Admin</option>
                                                    <option>Team Lead</option>
                                                    <option>Member</option>
                                                    <option>Guest</option>
                                                </select>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded-lg bg-background-dark border border-border-dark text-[10px] font-bold text-text-secondary uppercase tracking-widest w-fit whitespace-nowrap">{u.role}</span>
                                            )}
                                        </div>
                                        <div className="xl:px-6 xl:py-4 flex flex-col gap-1 xl:gap-1.5 xl:justify-center">
                                            <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest xl:hidden">Status & Activity</span>
                                            <div className="flex flex-col gap-0.5">
                                                <div className="flex items-center gap-2">
                                                    <span className={`size-1.5 rounded-full shrink-0 ${u.status === 'Active' ? 'bg-emerald-500' : u.status === 'Away' ? 'bg-orange-400' : u.status === 'Invited' ? 'bg-primary' : 'bg-slate-500'}`}></span>
                                                    <span className="text-xs text-text-secondary font-medium">{u.status}</span>
                                                </div>
                                                <span className="text-[10px] text-text-secondary/60 xl:ml-3.5">
                                                    {u.status === 'Invited' ? 'Pending invite' : `Active ${u.lastActive}`}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="sm:col-span-2 xl:col-span-1 xl:px-6 xl:py-4 flex flex-col gap-2 xl:gap-0 xl:justify-center">
                                            <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest xl:hidden">Active Projects</span>
                                            <div className="flex flex-wrap gap-1.5">
                                                {u.activeProjects && u.activeProjects.length > 0 ? (
                                                    u.activeProjects.map((project, idx) => (
                                                        <span key={idx} className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] font-medium text-text-secondary break-words max-w-full">
                                                            {project}
                                                        </span>
                                                    ))
                                                ) : (
                                                    <span className="text-[10px] italic text-text-secondary/50">No active projects</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="xl:px-6 xl:py-4 pt-4 mt-2 border-t border-border-dark xl:border-t-0 xl:mt-0 xl:pt-4 flex justify-end xl:block">
                                        <div className="flex gap-2 justify-end">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openModal('invite-to-project', { user: u });
                                                }}
                                                className="cursor-pointer px-4 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold uppercase tracking-widest hover:bg-primary hover:text-white transition-all whitespace-nowrap shadow-sm"
                                            >
                                                Assign
                                            </button>
                                            {can('manage_members') && u.id !== currentUser?.id && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteUser(u.id, u.name);
                                                    }}
                                                    className="cursor-pointer size-8 inline-flex items-center justify-center rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-all"
                                                    title={`Remove ${u.name} from workspace`}
                                                    aria-label={`Remove ${u.name} from workspace`}
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                        {!isLoading && currentUsers.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
                                <div className="size-16 rounded-2xl bg-surface-dark border border-border-dark flex items-center justify-center text-text-secondary mb-4">
                                    <span className="material-symbols-outlined text-3xl">search_off</span>
                                </div>
                                <h3 className="text-lg font-black text-white mb-2">No users found</h3>
                                <p className="text-sm text-text-secondary max-w-sm mb-6">
                                    We couldn't find any users matching your search or filter criteria. Try adjusting your filters.
                                </p>
                                <button
                                    onClick={() => { setSearchQuery(''); setRoleFilter('All Roles'); setStatusFilter('All Status'); setSortBy('Newest'); }}
                                    className="cursor-pointer px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-border-dark text-xs font-bold text-white transition-all"
                                >
                                    Clear all filters
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-4 bg-background-dark/30 border-t border-border-dark flex items-center justify-between">
                    <p className="text-xs text-text-secondary">Showing <span className="font-bold text-white">{Math.min(total, (currentPage - 1) * itemsPerPage + 1)}-{Math.min(total, currentPage * itemsPerPage)}</span> of <span className="font-bold text-white">{total}</span> users</p>
                    <div className="flex gap-2">
                        <button
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => p - 1)}
                            className="p-1.5 rounded-lg border border-border-dark text-text-secondary hover:text-white hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                        </button>
                        <button
                            disabled={currentPage === totalPages || totalPages === 0}
                            onClick={() => setCurrentPage(p => p + 1)}
                            className="p-1.5 rounded-lg border border-border-dark text-text-secondary hover:text-white hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default UserManagementSettings;
