'use client';

import React, { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useAppContext } from '@/context/AppContext';
import { useUIContext } from '@/context/UIContext';
import { AiGradientButton, AiSparkle, aiGradientTextClass } from '@/components/ai/AiUi';
import { api } from '@/lib/api';
import { Status, Priority, Sprint, User } from '@/types';
import PresenceDot from '@/components/PresenceDot';
import { presenceFromMemberStatus } from '@/lib/presence';
import { UNASSIGNED_ASSIGNEE_FILTER } from '@/lib/tasks/assigneeFilter';

interface TaskFiltersProps {
    onSearchChange: (query: string) => void;
    users: User[];
    /** Required for natural-language filter assistant (workspace roster). */
    workspaceId?: string | null;
    readOnly?: boolean;
}

const STATUSES: { value: Status; label: string }[] = [
    { value: 'backlog', label: 'Backlog' },
    { value: 'todo', label: 'To Do' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'review', label: 'Review' },
    { value: 'done', label: 'Done' },
];

const PRIORITIES: { value: Priority; label: string }[] = [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
];

export const TaskFilters: React.FC<TaskFiltersProps> = ({ onSearchChange, users, workspaceId, readOnly = false }) => {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { projectSprints: sprints, selectedSprintId, setSelectedSprintId } = useAppContext();
    const { addToast } = useUIContext();

    const [openDropdown, setOpenDropdown] = useState<'status' | 'priority' | 'assignee' | 'sprint' | 'nl' | null>(null);
    const filterRef = useRef<HTMLDivElement>(null);
    useClickOutside(filterRef, () => setOpenDropdown(null));

    const activeStatuses: Status[] = (searchParams.get('status') || '').split(',').filter(Boolean) as Status[];
    const activePriorities: Priority[] = (searchParams.get('priority') || '').split(',').filter(Boolean) as Priority[];
    const activeAssignee = searchParams.get('assignee') || '';

    const setParam = (key: string, values: string[]) => {
        const params = new URLSearchParams(searchParams.toString());
        if (values.length === 0) {
            params.delete(key);
        } else {
            params.set(key, values.join(','));
        }
        router.replace(`?${params.toString()}`, { scroll: false });
    };

    const toggleStatus = (s: Status) => {
        const next = activeStatuses.includes(s) ? activeStatuses.filter(x => x !== s) : [...activeStatuses, s];
        setParam('status', next);
    };

    const togglePriority = (p: Priority) => {
        const next = activePriorities.includes(p) ? activePriorities.filter(x => x !== p) : [...activePriorities, p];
        setParam('priority', next);
    };

    const setAssignee = (uid: string) => {
        setParam('assignee', uid === activeAssignee ? [] : [uid]);
        setOpenDropdown(null);
    };

    const hasFilters = activeStatuses.length > 0 || activePriorities.length > 0 || activeAssignee;

    const clearAll = () => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('status'); params.delete('priority'); params.delete('assignee');
        router.replace(`?${params.toString()}`, { scroll: false });
    };

    const [nlQuery, setNlQuery] = useState('');
    const [nlBusy, setNlBusy] = useState(false);

    const applyNlFilters = async () => {
        if (!workspaceId) {
            addToast('Workspace is required for AI filters.', 'warning');
            return;
        }
        const raw = nlQuery.trim();
        if (!raw) {
            addToast('Describe what you want to see (e.g. urgent in progress for Alex).', 'warning');
            return;
        }
        setNlBusy(true);
        try {
            const data = (await api.tasks.runAi({
                kind: 'filter_nl',
                workspaceId,
                nl: raw,
            })) as Record<string, unknown>;
            const params = new URLSearchParams(searchParams.toString());
            if (typeof data.q === 'string' && data.q.trim()) params.set('q', data.q.trim());
            else params.delete('q');
            if (Array.isArray(data.status) && data.status.length) {
                params.set('status', (data.status as string[]).join(','));
            } else {
                params.delete('status');
            }
            if (Array.isArray(data.priority) && data.priority.length) {
                params.set('priority', (data.priority as string[]).join(','));
            } else {
                params.delete('priority');
            }
            if (data.assignee_id === null) {
                params.delete('assignee');
            } else if (typeof data.assignee_id === 'string' && data.assignee_id) {
                params.set('assignee', data.assignee_id);
            }
            router.replace(`?${params.toString()}`, { scroll: false });
            if (typeof data.explanation === 'string' && data.explanation.trim()) {
                addToast(data.explanation.trim(), 'info');
            } else {
                addToast('Filters updated from your request.', 'success');
            }
            setOpenDropdown(null);
            setNlQuery('');
        } catch (e) {
            addToast(e instanceof Error ? e.message : 'AI filter failed', 'error');
        } finally {
            setNlBusy(false);
        }
    };

    const activeSprintData = sprints?.find((s: Sprint) => s.id === selectedSprintId);

    return (
        <div className="px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 shrink-0 border-b border-border-dark/30" ref={filterRef}>
            {/* Left: filter pills */}
            <div className="flex items-center gap-3 flex-wrap">
                {/* Sprint selector */}
                <div className="relative shrink-0">
                    <button
                        onClick={() => setOpenDropdown(openDropdown === 'sprint' ? null : 'sprint')}
                        className="flex cursor-pointer items-center gap-2 text-[12px] font-medium whitespace-nowrap"
                    >
                        <span className="text-text-secondary hover:text-white transition-colors">
                            {activeSprintData?.name || 'All Sprints'}
                        </span>
                        {activeSprintData?.status === 'active' && (
                            <span className="bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded font-black uppercase tracking-widest border border-emerald-500/20">
                                Active
                            </span>
                        )}
                        <span className="material-symbols-outlined text-text-secondary text-[14px]">unfold_more</span>
                    </button>
                    {openDropdown === 'sprint' && (
                        <div className="absolute top-full left-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 w-48 overflow-hidden animate-in fade-in duration-100">
                            <button
                                onClick={() => { setSelectedSprintId?.(null); setOpenDropdown(null); }}
                                className={`w-full cursor-pointer px-3 py-2 text-left text-xs font-bold hover:bg-white/5 transition-colors ${!selectedSprintId ? 'text-primary' : 'text-white'}`}
                            >
                                All Sprints
                            </button>
                            {(sprints || []).map((s: Sprint) => (
                                <button
                                    key={s.id}
                                    onClick={() => { setSelectedSprintId?.(s.id); setOpenDropdown(null); }}
                                    className={`w-full cursor-pointer px-3 py-2 text-left text-xs font-bold hover:bg-white/5 transition-colors flex justify-between items-center ${selectedSprintId === s.id ? 'text-primary' : 'text-white'}`}
                                >
                                    {s.name}
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${s.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-white/5 text-text-secondary border border-border-dark'}`}>
                                        {s.status}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="h-4 w-px bg-border-dark shrink-0"></div>

                {/* Status filter */}
                <div className="relative shrink-0">
                    <button
                        onClick={() => !readOnly && setOpenDropdown(openDropdown === 'status' ? null : 'status')}
                        disabled={readOnly}
                        className={`flex cursor-pointer items-center gap-1.5 px-2 py-1 border rounded-lg text-[11px] font-bold transition-all whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${activeStatuses.length ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border-dark border-dashed bg-surface-dark text-text-secondary hover:border-text-secondary'}`}
                    >
                        <span className="material-symbols-outlined text-xs">radio_button_checked</span>
                        Status {activeStatuses.length > 0 && `(${activeStatuses.length})`}
                    </button>
                    {openDropdown === 'status' && (
                        <div className="absolute top-full left-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 w-40 overflow-hidden animate-in fade-in duration-100">
                            {STATUSES.map(s => (
                                <button
                                    key={s.value}
                                    onClick={() => toggleStatus(s.value)}
                                    className="w-full cursor-pointer px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/5 transition-colors flex items-center gap-2"
                                >
                                    <div className={`size-3.5 rounded border-2 flex items-center justify-center transition-all ${activeStatuses.includes(s.value) ? 'bg-primary border-primary' : 'border-border-dark'}`}>
                                        {activeStatuses.includes(s.value) && <span className="material-symbols-outlined text-white text-[8px]">check</span>}
                                    </div>
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Priority filter */}
                <div className="relative shrink-0">
                    <button
                        onClick={() => !readOnly && setOpenDropdown(openDropdown === 'priority' ? null : 'priority')}
                        disabled={readOnly}
                        className={`flex cursor-pointer items-center gap-1.5 px-2 py-1 border rounded-lg text-[11px] font-bold transition-all whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${activePriorities.length ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border-dark border-dashed bg-surface-dark text-text-secondary hover:border-text-secondary'}`}
                    >
                        <span className="material-symbols-outlined text-xs">flag</span>
                        Priority {activePriorities.length > 0 && `(${activePriorities.length})`}
                    </button>
                    {openDropdown === 'priority' && (
                        <div className="absolute top-full left-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 w-36 overflow-hidden animate-in fade-in duration-100">
                            {PRIORITIES.map(p => (
                                <button
                                    key={p.value}
                                    onClick={() => togglePriority(p.value)}
                                    className="w-full cursor-pointer px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/5 transition-colors flex items-center gap-2"
                                >
                                    <div className={`size-3.5 rounded border-2 flex items-center justify-center transition-all ${activePriorities.includes(p.value) ? 'bg-primary border-primary' : 'border-border-dark'}`}>
                                        {activePriorities.includes(p.value) && <span className="material-symbols-outlined text-white text-[8px]">check</span>}
                                    </div>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Assignee filter */}
                <div className="relative shrink-0">
                    <button
                        onClick={() => !readOnly && setOpenDropdown(openDropdown === 'assignee' ? null : 'assignee')}
                        disabled={readOnly}
                        className={`flex cursor-pointer items-center gap-1.5 px-2 py-1 border rounded-lg text-[11px] font-bold transition-all whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${activeAssignee ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border-dark border-dashed bg-surface-dark text-text-secondary hover:border-text-secondary'}`}
                    >
                        <span className="material-symbols-outlined text-xs">person</span>
                        {activeAssignee === UNASSIGNED_ASSIGNEE_FILTER
                            ? 'Unassigned'
                            : activeAssignee
                              ? users.find(u => u.id === activeAssignee)?.name || 'Assignee'
                              : 'Assignee'}
                    </button>
                    {openDropdown === 'assignee' && (
                        <div className="absolute top-full left-0 mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 w-44 overflow-hidden animate-in fade-in duration-100 max-h-48 overflow-y-auto custom-scrollbar">
                            <button
                                onClick={() => setAssignee(UNASSIGNED_ASSIGNEE_FILTER)}
                                className="w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/5 transition-colors flex items-center gap-2 border-b border-border-dark/50"
                            >
                                <div className={`size-3.5 rounded border-2 flex items-center justify-center transition-all ${activeAssignee === UNASSIGNED_ASSIGNEE_FILTER ? 'bg-primary border-primary' : 'border-border-dark'}`}>
                                    {activeAssignee === UNASSIGNED_ASSIGNEE_FILTER && <span className="material-symbols-outlined text-white text-[8px]">check</span>}
                                </div>
                                <span className="material-symbols-outlined text-text-secondary text-sm">person_off</span>
                                Unassigned
                            </button>
                            {users.map((u: User) => (
                                <button
                                    key={u.id}
                                    onClick={() => setAssignee(u.id)}
                                    className="w-full cursor-pointer px-3 py-2 text-left text-xs font-bold text-white hover:bg-white/5 transition-colors flex items-center gap-2"
                                >
                                    <div className={`size-3.5 rounded border-2 flex items-center justify-center transition-all ${activeAssignee === u.id ? 'bg-primary border-primary' : 'border-border-dark'}`}>
                                        {activeAssignee === u.id && <span className="material-symbols-outlined text-white text-[8px]">check</span>}
                                    </div>
                                    <div className="relative inline-flex shrink-0">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={u.avatar} className="size-4 rounded-full" alt="" />
                                        <span className="absolute -bottom-0.5 -right-0.5">
                                            <PresenceDot status={presenceFromMemberStatus(u.status)} size="sm" ring />
                                        </span>
                                    </div>
                                    {u.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {hasFilters && (
                    <button
                        onClick={clearAll}
                        className="cursor-pointer flex items-center gap-1 text-[11px] font-bold text-red-400 hover:text-red-300 transition-colors shrink-0 whitespace-nowrap"
                    >
                        <span className="material-symbols-outlined text-xs">close</span>
                        Clear all
                    </button>
                )}
            </div>

            {/* Right: AI filter + Search */}
            <div className="flex items-center gap-2 sm:shrink-0">
                <div className="relative">
                    <button
                        type="button"
                        title={readOnly ? 'This project is read-only' : workspaceId ? 'Describe filters in plain language' : 'Select a workspace to use AI filters'}
                        disabled={readOnly || !workspaceId}
                        onClick={() => !readOnly && setOpenDropdown(openDropdown === 'nl' ? null : 'nl')}
                        className={`cursor-pointer flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-all ${
                            openDropdown === 'nl'
                                ? 'border-violet-500/40 bg-surface-dark'
                                : 'border-border-dark bg-surface-dark text-text-secondary hover:border-violet-500/30 hover:text-main'
                        } disabled:opacity-40 disabled:pointer-events-none`}
                    >
                        <AiSparkle size="xs" />
                        <span className={`hidden sm:inline ${aiGradientTextClass()}`}>AI filter</span>
                    </button>
                    {openDropdown === 'nl' && (
                        <div className="absolute top-full right-0 mt-1 w-[min(100vw-2rem,22rem)] rounded-xl border border-border-dark bg-background-dark shadow-2xl z-50 p-3 space-y-2 animate-in fade-in duration-100">
                            <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                                Natural language
                            </p>
                            <textarea
                                value={nlQuery}
                                onChange={(e) => setNlQuery(e.target.value)}
                                rows={3}
                                placeholder='e.g. "Show high priority todo for Sarah"'
                                className="w-full rounded-lg border border-border-dark bg-surface-dark px-2.5 py-2 text-xs text-main placeholder:text-text-secondary/50 focus:ring-2 focus:ring-primary/30 focus:outline-none resize-y min-h-[4rem]"
                            />
                            <AiGradientButton
                                busy={nlBusy}
                                disabled={!workspaceId}
                                onClick={() => void applyNlFilters()}
                                className="cursor-pointer w-full justify-center"
                            >
                                Apply to filters
                            </AiGradientButton>
                        </div>
                    )}
                </div>
                <div className="relative group flex-1 sm:flex-none">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-sm">search</span>
                    <input
                        type="text"
                        placeholder="Search tasks..."
                        defaultValue={searchParams.get('q') || ''}
                        onChange={e => {
                            onSearchChange(e.target.value);
                            const params = new URLSearchParams(searchParams.toString());
                            if (e.target.value) params.set('q', e.target.value); else params.delete('q');
                            router.replace(`?${params.toString()}`, { scroll: false });
                        }}
                        className="bg-surface-dark border border-border-dark rounded-lg pl-9 pr-4 py-1.5 text-xs text-white focus:ring-1 focus:ring-primary w-full sm:w-48 transition-all outline-none"
                    />
                </div>
            </div>
        </div>
    );
};
