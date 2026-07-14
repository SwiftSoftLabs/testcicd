'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useAppContext } from '@/context/AppContext';
import { useUIContext } from '@/context/UIContext';
import { api } from '@/lib/api';
import type { Task, Commit, PullRequest, Sprint, User, Project } from '@/types';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type ValidModule = 'tasks' | 'calendar' | 'version-control' | 'chat' | 'email' | 'files';

interface ConversationResult {
    id: string;
    name: string;
    type: 'channel' | 'dm';
}

interface EmailResult {
    id: string;
    subject: string;
    from_json: { name?: string; address?: string };
    received_at: string;
    is_read: boolean;
    folder?: string;
}

interface FileResult {
    id: string;
    file_name: string;
    file_type: string;
    file_size: number;
    folder_id: string | null;
    created_at: string;
}

const VALID_MODULES: ValidModule[] = ['tasks', 'calendar', 'version-control', 'chat', 'email', 'files'];

const MODULE_LABELS: Record<ValidModule, string> = {
    tasks: 'Tasks',
    calendar: 'Calendar',
    'version-control': 'Version Control',
    chat: 'Chat',
    email: 'Email',
    files: 'Files',
};

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

const STATUSES = [
    { value: 'backlog', label: 'Backlog' },
    { value: 'todo', label: 'To Do' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'review', label: 'Review' },
    { value: 'done', label: 'Done' },
];

const PRIORITIES = [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
];

const EMAIL_FOLDERS = ['inbox', 'starred', 'snoozed', 'sent', 'drafts'];

export default function AdvancedSearchPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const { openModal } = useUIContext();
    const {
        tasks, users, projects, projectSprints: sprints, commits, pullRequests,
        selectedWorkspaceId, currentUser,
    } = useAppContext();

    const module = params.module as string;

    useEffect(() => {
        if (module === 'analytics') { router.replace('/analytics'); return; }
        if (module === 'settings') { router.replace('/settings'); return; }
    }, [module, router]);

    const [conversations, setConversations] = useState<ConversationResult[]>([]);
    const [emails, setEmails] = useState<EmailResult[]>([]);
    const [workspaceFiles, setWorkspaceFiles] = useState<FileResult[]>([]);
    const [remoteLoading, setRemoteLoading] = useState(false);
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);
    const filterRef = useRef<HTMLDivElement>(null);

    const folder = searchParams.get('folder') ?? '';

    useEffect(() => {
        if (module !== 'chat' || !selectedWorkspaceId || !currentUser?.id) return;
        setRemoteLoading(true);
        api.chat.getConversations(selectedWorkspaceId)
            .then((res: unknown) => {
                const data = res as { data?: ConversationResult[] } | ConversationResult[];
                setConversations(Array.isArray(data) ? data : (data as { data?: ConversationResult[] }).data ?? []);
            })
            .catch(() => {})
            .finally(() => setRemoteLoading(false));
    }, [module, selectedWorkspaceId, currentUser?.id]);

    useEffect(() => {
        if (module !== 'email') return;
        setRemoteLoading(true);
        api.email.getAll(folder || 'inbox')
            .then(data => setEmails(data as EmailResult[]))
            .catch(() => {})
            .finally(() => setRemoteLoading(false));
    }, [module, folder]);

    useEffect(() => {
        if (module !== 'files' || !selectedWorkspaceId) return;
        setRemoteLoading(true);
        authenticatedFetch(`/api/files?workspace_id=${selectedWorkspaceId}`)
            .then(r => r.json())
            .then((data: { files?: FileResult[] }) => setWorkspaceFiles(data.files ?? []))
            .catch(() => {})
            .finally(() => setRemoteLoading(false));
    }, [module, selectedWorkspaceId]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
                setOpenDropdown(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const setParam = (key: string, value: string) => {
        const p = new URLSearchParams(searchParams.toString());
        if (value) p.set(key, value); else p.delete(key);
        router.replace(`?${p.toString()}`, { scroll: false });
    };

    const toggleMultiParam = (key: string, value: string) => {
        const current = (searchParams.get(key) ?? '').split(',').filter(Boolean);
        const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
        setParam(key, next.join(','));
    };

    const q = searchParams.get('q') ?? '';
    const statuses = (searchParams.get('status') ?? '').split(',').filter(Boolean);
    const priorities = (searchParams.get('priority') ?? '').split(',').filter(Boolean);
    const assignee = searchParams.get('assignee') ?? '';
    const sprintId = searchParams.get('sprint') ?? '';
    const projectId = searchParams.get('project') ?? '';
    const dueFrom = searchParams.get('dueFrom') ?? '';
    const dueTo = searchParams.get('dueTo') ?? '';
    const typeFilter = searchParams.get('type') ?? 'all';
    const isRead = searchParams.get('isRead') ?? '';

    const userMap = useMemo(() => new Map(users.map((u: User) => [u.id, u])), [users]);
    const projectMap = useMemo(() => new Map(projects.map((p: Project) => [p.id, p])), [projects]);

    const filteredTasks = useMemo(() => {
        if (module !== 'tasks' && module !== 'calendar') return [];
        const lq = q.toLowerCase();
        return tasks.filter((t: Task) => {
            if (module === 'calendar' && !t.dueDate) return false;
            if (lq && !t.title.toLowerCase().includes(lq) && !t.description?.toLowerCase().includes(lq)) return false;
            if (statuses.length && !statuses.includes(t.status)) return false;
            if (priorities.length && !priorities.includes(t.priority)) return false;
            if (assignee && t.assigneeId !== assignee) return false;
            if (sprintId && t.sprintId !== sprintId) return false;
            if (projectId && t.projectId !== projectId) return false;
            if (dueFrom && t.dueDate && t.dueDate < dueFrom) return false;
            if (dueTo && t.dueDate && t.dueDate > dueTo) return false;
            return true;
        }).sort((a: Task, b: Task) => module === 'calendar'
            ? (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
            : 0
        );
    }, [module, tasks, q, statuses, priorities, assignee, sprintId, projectId, dueFrom, dueTo]);

    const filteredCommits = useMemo(() => {
        if (module !== 'version-control' || typeFilter === 'prs') return [];
        const lq = q.toLowerCase();
        return (commits ?? []).filter((c: Commit) => !lq || c.message?.toLowerCase().includes(lq));
    }, [module, commits, q, typeFilter]);

    const filteredPRs = useMemo(() => {
        if (module !== 'version-control' || typeFilter === 'commits') return [];
        const lq = q.toLowerCase();
        return (pullRequests ?? []).filter((pr: PullRequest) => !lq || pr.title?.toLowerCase().includes(lq));
    }, [module, pullRequests, q, typeFilter]);

    const filteredConversations = useMemo(() => {
        const lq = q.toLowerCase();
        return conversations.filter(c => {
            if (typeFilter !== 'all' && c.type !== typeFilter) return false;
            if (lq && !c.name.toLowerCase().includes(lq)) return false;
            return true;
        });
    }, [conversations, q, typeFilter]);

    const filteredEmails = useMemo(() => {
        const lq = q.toLowerCase();
        return emails.filter(e => {
            if (isRead === 'read' && !e.is_read) return false;
            if (isRead === 'unread' && e.is_read) return false;
            if (lq && !e.subject?.toLowerCase().includes(lq)) return false;
            return true;
        });
    }, [emails, q, isRead]);

    const filteredFiles = useMemo(() => {
        const lq = q.toLowerCase();
        return workspaceFiles.filter(f => {
            if (lq && !f.file_name.toLowerCase().includes(lq)) return false;
            if (typeFilter && typeFilter !== 'all') {
                if (typeFilter === 'image' && !f.file_type.startsWith('image/')) return false;
                if (typeFilter === 'json' && f.file_type !== 'application/json') return false;
                if (typeFilter === 'markdown' && !f.file_type.includes('markdown') && !f.file_name.endsWith('.md')) return false;
                if (typeFilter === 'text' && !f.file_type.startsWith('text/') && f.file_type !== 'application/json') return false;
            }
            if (dueFrom && f.created_at < dueFrom) return false;
            if (dueTo && f.created_at > dueTo) return false;
            return true;
        });
    }, [workspaceFiles, q, typeFilter, dueFrom, dueTo]);

    if (!VALID_MODULES.includes(module as ValidModule)) return null;

    const mod = module as ValidModule;

    const totalCount = mod === 'tasks' || mod === 'calendar'
        ? filteredTasks.length
        : mod === 'version-control'
            ? filteredCommits.length + filteredPRs.length
            : mod === 'chat'
                ? filteredConversations.length
                : mod === 'files'
                    ? filteredFiles.length
                    : filteredEmails.length;

    const renderFilterPill = (label: string, key: string, active: boolean) => (
        <button
            key={key}
            onClick={() => setOpenDropdown(openDropdown === key ? null : key)}
            className={`cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                active ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border-dark border-dashed bg-surface-dark text-text-secondary hover:border-text-secondary'
            }`}
        >
            {label}
            <span className="material-symbols-outlined text-[12px]">expand_more</span>
        </button>
    );

    const renderDropdown = (key: string, children: React.ReactNode) => openDropdown === key ? (
        <div className="absolute top-full left-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 min-w-36 overflow-hidden animate-in fade-in duration-100">
            {children}
        </div>
    ) : null;

    const renderCheckItem = (label: string, isChecked: boolean, onClick: () => void) => (
        <button
            key={label}
            onClick={onClick}
            className="cursor-pointer w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/5 transition-colors flex items-center gap-2"
        >
            <div className={`size-3.5 rounded border-2 flex items-center justify-center transition-all ${isChecked ? 'bg-primary border-primary' : 'border-border-dark'}`}>
                {isChecked && <span className="material-symbols-outlined text-white text-[8px]">check</span>}
            </div>
            {label}
        </button>
    );

    const renderTasksFilters = () => (
        <>
            <div className="relative">
                {renderFilterPill(`Status${statuses.length ? ` (${statuses.length})` : ''}`, 'status', statuses.length > 0)}
                {renderDropdown('status',
                    STATUSES.map(s => renderCheckItem(s.label, statuses.includes(s.value), () => toggleMultiParam('status', s.value)))
                )}
            </div>
            <div className="relative">
                {renderFilterPill(`Priority${priorities.length ? ` (${priorities.length})` : ''}`, 'priority', priorities.length > 0)}
                {renderDropdown('priority',
                    PRIORITIES.map(p => renderCheckItem(p.label, priorities.includes(p.value), () => toggleMultiParam('priority', p.value)))
                )}
            </div>
            <div className="relative">
                {renderFilterPill(assignee ? (userMap.get(assignee)?.name ?? 'Assignee') : 'Assignee', 'assignee', !!assignee)}
                {renderDropdown('assignee',
                    users.map((u: User) => renderCheckItem(u.name, assignee === u.id, () => { setParam('assignee', assignee === u.id ? '' : u.id); setOpenDropdown(null); }))
                )}
            </div>
            <div className="relative">
                {renderFilterPill(sprintId ? (sprints.find((s: Sprint) => s.id === sprintId)?.name ?? 'Sprint') : 'Sprint', 'sprint', !!sprintId)}
                {renderDropdown('sprint', <>
                    <button onClick={() => { setParam('sprint', ''); setOpenDropdown(null); }} className="cursor-pointer w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/5">All Sprints</button>
                    {sprints.map((s: Sprint) => (
                        <button key={s.id} onClick={() => { setParam('sprint', s.id); setOpenDropdown(null); }} className={`cursor-pointer w-full px-3 py-2 text-left text-xs font-bold hover:bg-white/5 transition-colors ${sprintId === s.id ? 'text-primary' : 'text-white'}`}>{s.name}</button>
                    ))}
                </>)}
            </div>
            <div className="relative">
                {renderFilterPill(projectId ? (projectMap.get(projectId)?.name ?? 'Project') : 'Project', 'project', !!projectId)}
                {renderDropdown('project', <>
                    <button onClick={() => { setParam('project', ''); setOpenDropdown(null); }} className="cursor-pointer w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/5">All Projects</button>
                    {projects.map((p: Project) => (
                        <button key={p.id} onClick={() => { setParam('project', p.id); setOpenDropdown(null); }} className={`cursor-pointer w-full px-3 py-2 text-left text-xs font-bold hover:bg-white/5 transition-colors ${projectId === p.id ? 'text-primary' : 'text-white'}`}>{p.name}</button>
                    ))}
                </>)}
            </div>
            <div className="flex items-center gap-1.5">
                <input type="date" value={dueFrom} onChange={e => setParam('dueFrom', e.target.value)}
                    className="bg-surface-dark border border-border-dark rounded-lg px-2 py-1.5 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-primary" />
                <span className="text-text-secondary text-xs">–</span>
                <input type="date" value={dueTo} onChange={e => setParam('dueTo', e.target.value)}
                    className="bg-surface-dark border border-border-dark rounded-lg px-2 py-1.5 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
        </>
    );

    const renderCalendarFilters = () => (
        <>
            <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-secondary font-bold">Due:</span>
                <input type="date" value={dueFrom} onChange={e => setParam('dueFrom', e.target.value)}
                    className="bg-surface-dark border border-border-dark rounded-lg px-2 py-1.5 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-primary" />
                <span className="text-text-secondary text-xs">–</span>
                <input type="date" value={dueTo} onChange={e => setParam('dueTo', e.target.value)}
                    className="bg-surface-dark border border-border-dark rounded-lg px-2 py-1.5 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="relative">
                {renderFilterPill(`Status${statuses.length ? ` (${statuses.length})` : ''}`, 'status', statuses.length > 0)}
                {renderDropdown('status',
                    STATUSES.map(s => renderCheckItem(s.label, statuses.includes(s.value), () => toggleMultiParam('status', s.value)))
                )}
            </div>
            <div className="relative">
                {renderFilterPill(`Priority${priorities.length ? ` (${priorities.length})` : ''}`, 'priority', priorities.length > 0)}
                {renderDropdown('priority',
                    PRIORITIES.map(p => renderCheckItem(p.label, priorities.includes(p.value), () => toggleMultiParam('priority', p.value)))
                )}
            </div>
            <div className="relative">
                {renderFilterPill(assignee ? (userMap.get(assignee)?.name ?? 'Assignee') : 'Assignee', 'assignee', !!assignee)}
                {renderDropdown('assignee',
                    users.map((u: User) => renderCheckItem(u.name, assignee === u.id, () => { setParam('assignee', assignee === u.id ? '' : u.id); setOpenDropdown(null); }))
                )}
            </div>
        </>
    );

    const renderVcFilters = () => (
        <>
            <div className="flex items-center gap-1 bg-surface-dark border border-border-dark rounded-lg p-0.5">
                {(['all', 'commits', 'prs'] as const).map(t => (
                    <button key={t} onClick={() => setParam('type', t === 'all' ? '' : t)}
                        className={`cursor-pointer px-3 py-1 rounded-md text-xs font-bold transition-all capitalize ${typeFilter === t || (t === 'all' && !typeFilter) ? 'bg-primary/20 text-primary' : 'text-text-secondary hover:text-white'}`}>
                        {t === 'prs' ? 'PRs' : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>
        </>
    );

    const renderChatFilters = () => (
        <div className="flex items-center gap-1 bg-surface-dark border border-border-dark rounded-lg p-0.5">
            {(['all', 'channel', 'dm'] as const).map(t => (
                <button key={t} onClick={() => setParam('type', t === 'all' ? '' : t)}
                    className={`cursor-pointer px-3 py-1 rounded-md text-xs font-bold transition-all ${typeFilter === t || (t === 'all' && !typeFilter) ? 'bg-primary/20 text-primary' : 'text-text-secondary hover:text-white'}`}>
                    {t === 'dm' ? 'DMs' : t === 'channel' ? 'Channels' : 'All'}
                </button>
            ))}
        </div>
    );

    const renderEmailFilters = () => (
        <>
            <div className="relative">
                {renderFilterPill(folder ? folder.charAt(0).toUpperCase() + folder.slice(1) : 'Inbox', 'folder', !!folder)}
                {renderDropdown('folder',
                    EMAIL_FOLDERS.map(f => (
                        <button key={f} onClick={() => { setParam('folder', f === 'inbox' ? '' : f); setOpenDropdown(null); }}
                            className={`cursor-pointer w-full px-3 py-2 text-left text-xs font-bold hover:bg-white/5 transition-colors capitalize ${(folder || 'inbox') === f ? 'text-primary' : 'text-white'}`}>
                            {f}
                        </button>
                    ))
                )}
            </div>
            <div className="flex items-center gap-1 bg-surface-dark border border-border-dark rounded-lg p-0.5">
                {([['', 'All'], ['read', 'Read'], ['unread', 'Unread']] as const).map(([val, label]) => (
                    <button key={val} onClick={() => setParam('isRead', val)}
                        className={`cursor-pointer px-3 py-1 rounded-md text-xs font-bold transition-all ${isRead === val ? 'bg-primary/20 text-primary' : 'text-text-secondary hover:text-white'}`}>
                        {label}
                    </button>
                ))}
            </div>
        </>
    );

    const renderTaskRow = (task: Task) => {
        const assigneeUser = userMap.get(task.assigneeId);
        const project = task.projectId ? projectMap.get(task.projectId) : null;
        return (
            <button
                key={task.id}
                onClick={() => openModal('task-detail', { task })}
                className="cursor-pointer w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-border-dark/50 last:border-0"
            >
                <span className={`material-symbols-outlined text-[16px] mt-0.5 shrink-0 ${STATUS_COLORS[task.status] ?? 'text-text-secondary'}`}>
                    {task.status === 'done' ? 'task_alt' : 'radio_button_unchecked'}
                </span>
                <div className="flex-1 min-w-0">
                    <p className="text-sm text-main font-medium truncate">{task.title}</p>
                    <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                        <span className={`capitalize ${STATUS_COLORS[task.status]}`}>{task.status.replace('-', ' ')}</span>
                        {task.priority && <span className={`ml-2 ${PRIORITY_COLORS[task.priority]}`}>· {task.priority}</span>}
                        {assigneeUser && <span className="ml-2">· {assigneeUser.name}</span>}
                        {project && <span className="ml-2">· {project.name}</span>}
                        {task.dueDate && <span className="ml-2">· Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                    </p>
                </div>
            </button>
        );
    };

    const renderVcRow = (item: Commit | PullRequest) => {
        const isCommit = 'message' in item;
        return (
            <button
                key={item.id}
                onClick={() => router.push('/version-control')}
                className="cursor-pointer w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-border-dark/50 last:border-0"
            >
                <span className="material-symbols-outlined text-[16px] mt-0.5 text-text-secondary shrink-0">
                    {isCommit ? 'commit' : 'merge'}
                </span>
                <div className="flex-1 min-w-0">
                    <p className="text-sm text-main font-medium truncate">{isCommit ? (item as Commit).message : (item as PullRequest).title}</p>
                    <p className="text-[11px] text-text-secondary mt-0.5">
                        {isCommit ? 'Commit' : `PR · ${(item as PullRequest).status}`}
                        {item.author?.full_name && ` · ${item.author.full_name}`}
                    </p>
                </div>
            </button>
        );
    };

    const renderChatRow = (conv: ConversationResult) => (
        <button
            key={conv.id}
            onClick={() => router.push('/chat')}
            className="cursor-pointer w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-border-dark/50 last:border-0"
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

    const renderEmailRow = (email: EmailResult) => {
        const senderName = email.from_json?.name || email.from_json?.address || 'Unknown';
        return (
            <button
                key={email.id}
                onClick={() => router.push(`/email/${email.id}`)}
                className="cursor-pointer w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-border-dark/50 last:border-0"
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

    const renderFilesFilters = () => (
        <>
            <div className="flex items-center gap-1 bg-surface-dark border border-border-dark rounded-lg p-0.5">
                {(['all', 'image', 'text', 'json', 'markdown'] as const).map(t => (
                    <button key={t} onClick={() => setParam('type', t === 'all' ? '' : t)}
                        className={`cursor-pointer px-3 py-1 rounded-md text-xs font-bold transition-all capitalize ${typeFilter === t || (t === 'all' && !typeFilter) ? 'bg-primary/20 text-primary' : 'text-text-secondary hover:text-white'}`}>
                        {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>
            <div className="flex items-center gap-1.5">
                <span className="text-xs text-text-secondary font-bold">Uploaded:</span>
                <input type="date" value={dueFrom} onChange={e => setParam('dueFrom', e.target.value)}
                    className="bg-surface-dark border border-border-dark rounded-lg px-2 py-1.5 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-primary" />
                <span className="text-text-secondary text-xs">–</span>
                <input type="date" value={dueTo} onChange={e => setParam('dueTo', e.target.value)}
                    className="bg-surface-dark border border-border-dark rounded-lg px-2 py-1.5 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
        </>
    );

    const renderFileRow = (file: FileResult) => (
        <a
            key={file.id}
            href={`/api/files/${file.id}/download`}
            target="_blank"
            rel="noreferrer"
            className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-border-dark/50 last:border-0"
        >
            <span className="material-symbols-outlined text-[16px] mt-0.5 text-text-secondary shrink-0">
                {file.file_type.startsWith('image/') ? 'image' : file.file_type === 'application/json' ? 'data_object' : 'description'}
            </span>
            <div className="flex-1 min-w-0">
                <p className="text-sm text-main font-medium truncate">{file.file_name}</p>
                <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                    {file.file_type}
                    {' · '}
                    {file.file_size < 1048576
                        ? `${(file.file_size / 1024).toFixed(1)} KB`
                        : `${(file.file_size / 1048576).toFixed(1)} MB`}
                    {' · '}
                    {new Date(file.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
            </div>
            <span className="material-symbols-outlined text-[14px] text-text-secondary shrink-0 self-center">download</span>
        </a>
    );

    const hasActiveFilters = statuses.length > 0 || priorities.length > 0 || assignee || sprintId || projectId || dueFrom || dueTo || (typeFilter && typeFilter !== 'all') || (typeFilter && typeFilter !== 'all') || isRead || folder;

    const clearFilters = () => {
        router.replace(`?q=${encodeURIComponent(q)}`, { scroll: false });
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex items-center gap-4 px-6 py-4 border-b border-border-dark shrink-0">
                <button onClick={() => router.back()} className="cursor-pointer p-1.5 text-text-secondary hover:text-white bg-white/5 hover:bg-white/10 rounded-lg border border-border-dark transition-colors">
                    <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                </button>
                <h1 className="text-lg font-black text-white">{MODULE_LABELS[mod]} Search</h1>
                {remoteLoading && <div className="size-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin ml-2"></div>}
            </div>

            <div className="px-6 py-3 border-b border-border-dark/50 shrink-0" ref={filterRef}>
                <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-sm">search</span>
                        <input
                            type="text"
                            placeholder={`Search ${MODULE_LABELS[mod].toLowerCase()}...`}
                            value={q}
                            onChange={e => setParam('q', e.target.value)}
                            className="bg-surface-dark border border-border-dark rounded-lg pl-9 pr-4 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary outline-none w-56 transition-all"
                        />
                    </div>

                    <div className="h-4 w-px bg-border-dark"></div>

                    {mod === 'tasks' && renderTasksFilters()}
                    {mod === 'calendar' && renderCalendarFilters()}
                    {mod === 'version-control' && renderVcFilters()}
                    {mod === 'chat' && renderChatFilters()}
                    {mod === 'email' && renderEmailFilters()}
                    {mod === 'files' && renderFilesFilters()}

                    {hasActiveFilters && (
                        <button onClick={clearFilters} className="cursor-pointer flex items-center gap-1 text-[11px] font-bold text-red-400 hover:text-red-300 transition-colors">
                            <span className="material-symbols-outlined text-xs">close</span>
                            Clear filters
                        </button>
                    )}
                </div>
            </div>

            <div className="px-6 py-2 shrink-0">
                <span className="text-[11px] text-text-secondary font-bold uppercase tracking-widest">
                    {totalCount} result{totalCount !== 1 ? 's' : ''}
                </span>
            </div>

            <div className="flex-1 overflow-y-auto px-4">
                {(mod === 'tasks' || mod === 'calendar') && filteredTasks.map(renderTaskRow)}
                {mod === 'version-control' && <>
                    {filteredCommits.map(c => renderVcRow(c))}
                    {filteredPRs.map(pr => renderVcRow(pr))}
                </>}
                {mod === 'chat' && filteredConversations.map(renderChatRow)}
                {mod === 'email' && filteredEmails.map(renderEmailRow)}
                {mod === 'files' && filteredFiles.map(renderFileRow)}

                {totalCount === 0 && !remoteLoading && (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <span className="material-symbols-outlined text-4xl text-text-secondary/20 mb-3">search_off</span>
                        <p className="text-sm font-semibold text-main">No results found</p>
                        <p className="text-xs text-text-secondary mt-1">Try adjusting your search or filters</p>
                    </div>
                )}
            </div>
        </div>
    );
}
