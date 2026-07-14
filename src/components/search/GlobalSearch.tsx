'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useUIContext } from '@/context/UIContext';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';
import { api } from '@/lib/api';
import type { PermissionKey } from '@/lib/rbac/permissions';
import type { Task, User, Project, Commit, PullRequest } from '@/types';

type ModuleKey = 'tasks' | 'calendar' | 'version-control' | 'chat' | 'email' | 'files' | 'analytics' | 'settings';

interface ConversationResult {
    id: string;
    name: string;
    type: 'channel' | 'dm';
    description?: string;
}

interface FileResult {
    id: string;
    file_name: string;
    file_type: string;
    file_size: number;
    folder_id: string | null;
    created_at: string;
}

interface EmailResult {
    id: string;
    subject: string;
    from_json: { name?: string; address?: string };
    received_at: string;
    is_read: boolean;
}

interface AnalyticsShortcut {
    label: string;
    url: string;
    icon: string;
}

interface SettingShortcut {
    label: string;
    url: string;
    icon: string;
    /** Single key, or any key in array (OR). */
    requires?: PermissionKey | PermissionKey[];
}

interface AllResults {
    tasks: Task[];
    calendar: Task[];
    versionControl: { commits: Commit[]; prs: PullRequest[] };
    chat: ConversationResult[];
    email: EmailResult[];
    files: FileResult[];
    analytics: AnalyticsShortcut[];
    settings: SettingShortcut[];
}

interface GlobalSearchProps {
    initialQuery: string;
    workspaceId: string;
    tasks: Task[];
    users: User[];
    projects: Project[];
    commits: Commit[];
    pullRequests: PullRequest[];
    onClose: () => void;
}

const MODULES: { key: ModuleKey; label: string; icon: string; route: string; requires?: PermissionKey }[] = [
    { key: 'tasks', label: 'Tasks', icon: 'assignment', route: '/tasks' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar_month', route: '/calendar' },
    { key: 'version-control', label: 'Version Control', icon: 'account_tree', route: '/version-control', requires: 'access_repositories' },
    { key: 'chat', label: 'Chat', icon: 'chat', route: '/chat' },
    { key: 'email', label: 'Email', icon: 'mail', route: '/email' },
    { key: 'files', label: 'Files', icon: 'folder', route: '/files' },
    { key: 'analytics', label: 'Analytics', icon: 'bar_chart', route: '/analytics' },
    { key: 'settings', label: 'Settings', icon: 'settings', route: '/settings' },
];

const ANALYTICS_SHORTCUTS: AnalyticsShortcut[] = [
    { label: 'Workspace Overview', url: '/analytics', icon: 'grid_view' },
    { label: 'Project Reports', url: '/analytics', icon: 'folder' },
    { label: 'Team Performance', url: '/analytics', icon: 'group' },
];

const SETTINGS_SHORTCUTS: SettingShortcut[] = [
    { label: 'Profile', url: '/settings/profile', icon: 'person' },
    { label: 'Team Members', url: '/settings/users', icon: 'group', requires: ['invite_members', 'manage_members'] },
    { label: 'Roles', url: '/settings/roles', icon: 'admin_panel_settings', requires: 'manage_roles' },
    { label: 'Permissions', url: '/settings/permissions', icon: 'lock', requires: 'manage_roles' },
    { label: 'Workspace', url: '/settings/workspace', icon: 'domain', requires: 'workspace_settings' },
    { label: 'Notifications', url: '/settings/notifications', icon: 'notifications' },
    { label: 'Plugins', url: '/settings/plugins', icon: 'electrical_services' },
    { label: 'Billing', url: '/settings/billing', icon: 'credit_card', requires: 'billing_management' },
    { label: 'Security', url: '/settings/security', icon: 'security' },
    { label: 'Activity Logs', url: '/settings/activity-logs', icon: 'history', requires: 'view_audit_logs' },
];

function isShortcutAllowed(
    requires: PermissionKey | PermissionKey[] | undefined,
    can: (key: PermissionKey) => boolean,
    loading: boolean,
): boolean {
    if (!requires) return true;
    if (loading) return false;
    if (Array.isArray(requires)) return requires.some((key) => can(key));
    return can(requires);
}

const STATUS_COLORS: Record<string, string> = {
    done: 'text-emerald-400',
    'in-progress': 'text-orange-400',
    review: 'text-purple-400',
    todo: 'text-blue-400',
    backlog: 'text-text-secondary',
};

const PRIORITY_COLORS: Record<string, string> = {
    urgent: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-yellow-400',
    low: 'text-text-secondary',
};

const SEARCHABLE_MODULES: ModuleKey[] = ['tasks', 'calendar', 'version-control', 'chat', 'email', 'files'];

function getResultCount(results: AllResults, key: ModuleKey): number {
    switch (key) {
        case 'tasks': return results.tasks.length;
        case 'calendar': return results.calendar.length;
        case 'version-control': return results.versionControl.commits.length + results.versionControl.prs.length;
        case 'chat': return results.chat.length;
        case 'email': return results.email.length;
        case 'files': return results.files.length;
        case 'analytics': return results.analytics.length;
        case 'settings': return results.settings.length;
    }
}

const EMPTY_RESULTS: AllResults = {
    tasks: [], calendar: [], versionControl: { commits: [], prs: [] },
    chat: [], email: [], files: [], analytics: [], settings: [],
};

export default function GlobalSearch({
    initialQuery, workspaceId, tasks, users, projects, commits, pullRequests, onClose,
}: GlobalSearchProps) {
    const router = useRouter();
    const { openModal } = useUIContext();
    const { can, loading: permsLoading } = useWorkspacePermissions();
    const [query, setQuery] = useState(initialQuery);
    const [activeTab, setActiveTab] = useState<ModuleKey>('tasks');
    const [results, setResults] = useState<AllResults>(EMPTY_RESULTS);
    const [loading, setLoading] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);
    const projectMap = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);

    const visibleModules = useMemo(
        () => MODULES.filter((mod) => isShortcutAllowed(mod.requires, can, permsLoading)),
        [can, permsLoading],
    );

    const allowedSettingsShortcuts = useMemo(
        () => SETTINGS_SHORTCUTS.filter((s) => isShortcutAllowed(s.requires, can, permsLoading)),
        [can, permsLoading],
    );

    const computeClientResults = useCallback((q: string): Partial<AllResults> => {
        const lq = q.toLowerCase();
        const canSeeVc = isShortcutAllowed('access_repositories', can, permsLoading);
        return {
            tasks: tasks
                .filter(t => t.title.toLowerCase().includes(lq) || t.description?.toLowerCase().includes(lq) || t.tags?.some(tag => tag.toLowerCase().includes(lq)))
                .slice(0, 5),
            calendar: tasks
                .filter(t => t.dueDate && t.title.toLowerCase().includes(lq))
                .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
                .slice(0, 5),
            versionControl: canSeeVc ? {
                commits: commits.filter(c => c.message?.toLowerCase().includes(lq)).slice(0, 5),
                prs: pullRequests.filter(pr => pr.title?.toLowerCase().includes(lq)).slice(0, 5),
            } : { commits: [], prs: [] },
            analytics: ANALYTICS_SHORTCUTS.filter(s => s.label.toLowerCase().includes(lq)),
            settings: allowedSettingsShortcuts.filter(s => s.label.toLowerCase().includes(lq)),
        };
    }, [tasks, commits, pullRequests, can, permsLoading, allowedSettingsShortcuts]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        if (query.length < 3) {
            setResults(EMPTY_RESULTS);
            setLoading(false);
            return;
        }

        const clientResults = computeClientResults(query);
        setResults(prev => ({ ...prev, ...clientResults }));

        if (debounceRef.current) clearTimeout(debounceRef.current);
        setLoading(true);

        debounceRef.current = setTimeout(async () => {
            try {
                const res = await api.search.global(query, workspaceId) as {
                    conversations?: ConversationResult[];
                    emails?: EmailResult[];
                    files?: FileResult[];
                };
                setResults(prev => ({
                    ...prev,
                    chat: (res.conversations ?? []).slice(0, 5),
                    email: (res.emails ?? []).slice(0, 5),
                    files: (res.files ?? []).slice(0, 5),
                }));
            } catch {
                // silently ignore
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, workspaceId, computeClientResults]);

    useEffect(() => {
        if (query.length < 3) return;
        if (getResultCount(results, activeTab) > 0) return;
        const firstWithResults = visibleModules.find(m => getResultCount(results, m.key) > 0);
        if (firstWithResults) setActiveTab(firstWithResults.key);
    }, [results, query, activeTab, visibleModules]);

    useEffect(() => {
        if (visibleModules.some((m) => m.key === activeTab)) return;
        const fallback = visibleModules[0]?.key;
        if (fallback) setActiveTab(fallback);
    }, [visibleModules, activeTab]);

    useEffect(() => {
        setActiveIndex(0);
    }, [activeTab]);

    const activeResults = useMemo(() => {
        switch (activeTab) {
            case 'tasks': return results.tasks;
            case 'calendar': return results.calendar;
            case 'version-control': return [...results.versionControl.commits, ...results.versionControl.prs];
            case 'chat': return results.chat;
            case 'email': return results.email;
            case 'files': return results.files;
            case 'analytics': return results.analytics;
            case 'settings': return results.settings;
        }
    }, [activeTab, results]);

    const handleSelectItem = useCallback((item: unknown) => {
        if (!item) return;
        onClose();

        if (activeTab === 'tasks' || activeTab === 'calendar') {
            openModal('task-detail', { task: item as Task });
        } else if (activeTab === 'version-control') {
            router.push('/version-control');
        } else if (activeTab === 'chat') {
            router.push('/chat');
        } else if (activeTab === 'email') {
            const email = item as EmailResult;
            router.push(`/email/${email.id}`);
        } else if (activeTab === 'files') {
            router.push('/files');
        } else if (activeTab === 'analytics') {
            router.push((item as AnalyticsShortcut).url);
        } else if (activeTab === 'settings') {
            router.push((item as SettingShortcut).url);
        }
    }, [activeTab, router, openModal, onClose]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { onClose(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, activeResults.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
        if (e.key === 'Enter') { e.preventDefault(); handleSelectItem(activeResults[activeIndex]); }
    }, [activeResults, activeIndex, handleSelectItem, onClose]);

    const handleViewAll = useCallback(() => {
        const isSearchableMod = SEARCHABLE_MODULES.includes(activeTab);
        const route = isSearchableMod
            ? `/search/${activeTab}?q=${encodeURIComponent(query)}`
            : visibleModules.find(m => m.key === activeTab)!.route;
        router.push(route);
        onClose();
    }, [activeTab, query, router, onClose, visibleModules]);

    const renderTaskResult = (task: Task, idx: number) => {
        const assignee = userMap.get(task.assigneeId);
        const project = task.projectId ? projectMap.get(task.projectId) : null;
        return (
            <button
                key={task.id}
                onClick={() => handleSelectItem(task)}
                className={`cursor-pointer w-full flex items-start gap-3 px-4 py-3 text-left transition-colors rounded-lg ${idx === activeIndex ? 'bg-primary/10 border border-primary/20' : 'hover:bg-white/5 border border-transparent'}`}
            >
                <span className={`material-symbols-outlined text-[16px] mt-0.5 shrink-0 ${STATUS_COLORS[task.status] ?? 'text-text-secondary'}`}>
                    {task.status === 'done' ? 'task_alt' : 'radio_button_unchecked'}
                </span>
                <div className="flex-1 min-w-0">
                    <p className="text-sm text-main font-medium truncate">{task.title}</p>
                    <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                        <span className={`capitalize ${STATUS_COLORS[task.status]}`}>{task.status.replace('-', ' ')}</span>
                        {task.priority && <span className={`ml-2 ${PRIORITY_COLORS[task.priority]}`}>· {task.priority}</span>}
                        {assignee && <span className="ml-2">· {assignee.name}</span>}
                        {project && <span className="ml-2">· {project.name}</span>}
                        {task.dueDate && <span className="ml-2">· {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                    </p>
                </div>
            </button>
        );
    };

    const renderVcResult = (item: Commit | PullRequest, idx: number) => {
        const isCommit = 'message' in item;
        return (
            <button
                key={item.id}
                onClick={() => handleSelectItem(item)}
                className={`cursor-pointer w-full flex items-start gap-3 px-4 py-3 text-left transition-colors rounded-lg ${idx === activeIndex ? 'bg-primary/10 border border-primary/20' : 'hover:bg-white/5 border border-transparent'}`}
            >
                <span className="material-symbols-outlined text-[16px] mt-0.5 text-text-secondary shrink-0">
                    {isCommit ? 'commit' : 'merge'}
                </span>
                <div className="flex-1 min-w-0">
                    <p className="text-sm text-main font-medium truncate">{isCommit ? (item as Commit).message : (item as PullRequest).title}</p>
                    <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                        {isCommit ? 'Commit' : `PR · ${(item as PullRequest).status}`}
                        {item.author?.full_name && ` · ${item.author.full_name}`}
                    </p>
                </div>
            </button>
        );
    };

    const renderChatResult = (conv: ConversationResult, idx: number) => (
        <button
            key={conv.id}
            onClick={() => handleSelectItem(conv)}
            className={`cursor-pointer w-full flex items-start gap-3 px-4 py-3 text-left transition-colors rounded-lg ${idx === activeIndex ? 'bg-primary/10 border border-primary/20' : 'hover:bg-white/5 border border-transparent'}`}
        >
            <span className="material-symbols-outlined text-[16px] mt-0.5 text-text-secondary shrink-0">
                {conv.type === 'dm' ? 'person' : 'tag'}
            </span>
            <div className="flex-1 min-w-0">
                <p className="text-sm text-main font-medium truncate">{conv.name}</p>
                <p className="text-[11px] text-text-secondary mt-0.5 capitalize">{conv.type === 'dm' ? 'Direct Message' : 'Channel'}</p>
            </div>
        </button>
    );

    const renderEmailResult = (email: EmailResult, idx: number) => {
        const senderName = email.from_json?.name || email.from_json?.address || 'Unknown';
        return (
            <button
                key={email.id}
                onClick={() => handleSelectItem(email)}
                className={`cursor-pointer w-full flex items-start gap-3 px-4 py-3 text-left transition-colors rounded-lg ${idx === activeIndex ? 'bg-primary/10 border border-primary/20' : 'hover:bg-white/5 border border-transparent'}`}
            >
                <span className="material-symbols-outlined text-[16px] mt-0.5 text-text-secondary shrink-0">mail</span>
                <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${email.is_read ? 'text-text-secondary' : 'text-main font-medium'}`}>{email.subject || '(no subject)'}</p>
                    <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                        {senderName} · {new Date(email.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                </div>
            </button>
        );
    };

    const renderFileResult = (file: FileResult, idx: number) => (
        <button
            key={file.id}
            onClick={() => handleSelectItem(file)}
            className={`cursor-pointer w-full flex items-start gap-3 px-4 py-3 text-left transition-colors rounded-lg ${idx === activeIndex ? 'bg-primary/10 border border-primary/20' : 'hover:bg-white/5 border border-transparent'}`}
        >
            <span className="material-symbols-outlined text-[16px] mt-0.5 text-text-secondary shrink-0">
                {file.file_type.startsWith('image/') ? 'image' : file.file_type === 'application/json' ? 'data_object' : 'description'}
            </span>
            <div className="flex-1 min-w-0">
                <p className="text-sm text-main font-medium truncate">{file.file_name}</p>
                <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                    {file.file_type}
                    {file.file_size < 1048576
                        ? ` · ${(file.file_size / 1024).toFixed(1)} KB`
                        : ` · ${(file.file_size / 1048576).toFixed(1)} MB`}
                </p>
            </div>
        </button>
    );

    const renderShortcutResult = (item: AnalyticsShortcut | SettingShortcut, idx: number) => (
        <button
            key={item.url + item.label}
            onClick={() => handleSelectItem(item)}
            className={`cursor-pointer w-full flex items-center gap-3 px-4 py-3 text-left transition-colors rounded-lg ${idx === activeIndex ? 'bg-primary/10 border border-primary/20' : 'hover:bg-white/5 border border-transparent'}`}
        >
            <span className="material-symbols-outlined text-[16px] text-text-secondary shrink-0">{item.icon}</span>
            <p className="text-sm text-main">{item.label}</p>
        </button>
    );

    const renderResults = () => {
        if (query.length < 3) {
            return (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                    <span className="material-symbols-outlined text-3xl text-text-secondary/20 mb-2">search</span>
                    <p className="text-xs text-text-secondary">Type 3 or more characters to search</p>
                </div>
            );
        }

        const count = getResultCount(results, activeTab);
        const activeLabel = visibleModules.find(m => m.key === activeTab)?.label ?? MODULES.find(m => m.key === activeTab)?.label ?? '';

        if (count === 0 && !loading) {
            return (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                    <span className="material-symbols-outlined text-3xl text-text-secondary/20 mb-2">search_off</span>
                    <p className="text-sm font-semibold text-main">No results in {activeLabel}</p>
                    <p className="text-xs text-text-secondary mt-1">Try a different keyword</p>
                </div>
            );
        }

        return (
            <div className="flex flex-col">
                <div className="flex items-center justify-between px-4 pt-3 pb-1 shrink-0">
                    <span className="text-[10px] font-black text-text-secondary uppercase tracking-widest">
                        {activeLabel} · {count} result{count !== 1 ? 's' : ''}
                    </span>
                    {loading && <div className="size-3 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>}
                </div>

                <div className="px-2 pb-2 space-y-0.5">
                    {activeTab === 'tasks' && results.tasks.map((t, i) => renderTaskResult(t, i))}
                    {activeTab === 'calendar' && results.calendar.map((t, i) => renderTaskResult(t, i))}
                    {activeTab === 'version-control' && [
                        ...results.versionControl.commits.map((c, i) => renderVcResult(c, i)),
                        ...results.versionControl.prs.map((pr, i) => renderVcResult(pr, results.versionControl.commits.length + i)),
                    ]}
                    {activeTab === 'chat' && results.chat.map((c, i) => renderChatResult(c, i))}
                    {activeTab === 'email' && results.email.map((e, i) => renderEmailResult(e, i))}
                    {activeTab === 'files' && results.files.map((f, i) => renderFileResult(f, i))}
                    {activeTab === 'analytics' && results.analytics.map((s, i) => renderShortcutResult(s, i))}
                    {activeTab === 'settings' && results.settings.map((s, i) => renderShortcutResult(s, i))}
                </div>

                <div className="border-t border-border-dark px-4 py-2">
                    <button
                        onClick={handleViewAll}
                        className="cursor-pointer text-[11px] text-primary hover:underline flex items-center gap-1"
                    >
                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                        View all results in {activeLabel}
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed top-16 inset-x-0 z-50 flex justify-center px-8 pt-6 pointer-events-none">
            <div
                className="pointer-events-auto w-full max-w-5xl bg-surface-dark border border-border-dark rounded-xl shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden flex flex-col max-h-[calc(100vh-100px)]"
                onKeyDown={handleKeyDown}
            >
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border-dark shrink-0">
                    <span className="material-symbols-outlined text-text-secondary text-[20px] shrink-0">search</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search across tasks, calendar, version control, chat, email..."
                        className="flex-1 bg-transparent text-main text-sm placeholder:text-text-secondary/50 outline-none"
                    />
                    <button
                        onClick={onClose}
                        className="cursor-pointer text-[10px] font-bold text-text-secondary bg-white/5 border border-border-dark px-2 py-1 rounded-md hover:bg-white/10 transition-colors shrink-0"
                    >
                        Esc
                    </button>
                </div>

                <div className="flex items-center gap-1 px-3 py-2 border-b border-border-dark overflow-x-auto shrink-0">
                    {visibleModules.map(mod => {
                        const count = query.length >= 3 ? getResultCount(results, mod.key) : null;
                        const isActive = activeTab === mod.key;
                        const isEmpty = count !== null && count === 0;
                        return (
                            <button
                                key={mod.key}
                                onClick={() => setActiveTab(mod.key)}
                                className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all shrink-0 border
                                    ${isActive
                                        ? 'bg-primary/20 text-primary border-primary/30'
                                        : isEmpty
                                            ? 'text-text-secondary/30 border-transparent'
                                            : 'text-text-secondary hover:text-white hover:bg-white/5 border-transparent'
                                    }`}
                            >
                                <span className="material-symbols-outlined text-[13px]">{mod.icon}</span>
                                {mod.label}
                                {count !== null && count > 0 && (
                                    <span className={`text-[10px] px-1 rounded-full ${isActive ? 'bg-primary/20' : 'bg-white/10'}`}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                    {renderResults()}
                </div>
            </div>
        </div>
    );
}
