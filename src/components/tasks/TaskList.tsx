'use client';

import React, { useMemo, useState } from 'react';
import { TaskSourceBadge } from '@/components/tasks/TaskSourceBadge';
import { useUIContext } from '@/context/UIContext';
import { getTaskDisplayKey } from '@/lib/tasks/taskKey';
import { useAppContext } from '@/context/AppContext';
import { Status, Task, User } from '@/types';
import { format, isPast, isToday, parseISO } from 'date-fns';
import PresenceDot from '@/components/PresenceDot';
import { presenceFromMemberStatus } from '@/lib/presence';

interface TaskListProps {
    tasks: Task[];
    users: User[];
    selectedIds?: Set<string>;
    onSelectChange?: (id: string, selected: boolean) => void;
    isReadOnly?: boolean;
}

type SortKey = 'id' | 'title' | 'priority' | 'status' | 'dueDate' | 'tags' | 'assignee';

const STATUS_COLORS: Record<Status, string> = {
    backlog: 'bg-slate-400/10 text-slate-400 border-slate-400/20',
    todo: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
    'in-progress': 'bg-primary/10 text-primary border-primary/20',
    review: 'bg-purple-400/10 text-purple-400 border-purple-400/20',
    done: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
};

const STATUSES: Status[] = ['backlog', 'todo', 'in-progress', 'review', 'done'];
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = { backlog: 0, todo: 1, 'in-progress': 2, review: 3, done: 4 };

export const TaskList: React.FC<TaskListProps> = ({ tasks, users, selectedIds = new Set(), onSelectChange, isReadOnly = false }) => {
    const { openModal } = useUIContext();
    const { updateTask } = useAppContext();
    const [inlineStatusId, setInlineStatusId] = useState<string | null>(null);
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

    const cycleSort = (key: SortKey) =>
        setSort(prev =>
            prev?.key !== key ? { key, dir: 'asc' }
            : prev.dir === 'asc' ? { key, dir: 'desc' }
            : null
        );

    const sortedTasks = useMemo(() => {
        if (!sort) return tasks;
        const { key, dir } = sort;
        const mul = dir === 'asc' ? 1 : -1;

        return [...tasks].sort((a, b) => {
            let cmp = 0;
            switch (key) {
                case 'id':       cmp = a.id.localeCompare(b.id); break;
                case 'title':    cmp = a.title.localeCompare(b.title); break;
                case 'priority': cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]; break;
                case 'status':   cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]; break;
                case 'dueDate': {
                    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
                    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
                    cmp = da - db;
                    break;
                }
                case 'tags':     cmp = (a.tags[0] ?? '').localeCompare(b.tags[0] ?? ''); break;
                case 'assignee': {
                    const ua = users.find(u => u.id === a.assigneeId)?.name ?? '';
                    const ub = users.find(u => u.id === b.assigneeId)?.name ?? '';
                    cmp = ua.localeCompare(ub);
                    break;
                }
            }
            return cmp * mul;
        });
    }, [tasks, sort, users]);

    const SortBtn = ({ col, label }: { col: SortKey; label: string }) => (
        <button
            onClick={() => cycleSort(col)}
            className="cursor-pointer flex items-center gap-0.5 hover:text-white transition-colors group"
        >
            {label}
            <span className={`material-symbols-outlined text-[8px] leading-none transition-colors ${sort?.key === col ? 'text-primary' : 'text-border-dark group-hover:text-text-secondary'}`}>
                {sort?.key === col && sort.dir === 'asc' ? 'arrow_upward'
                 : sort?.key === col && sort.dir === 'desc' ? 'arrow_downward'
                 : 'swap_vert'}
            </span>
        </button>
    );

    const getPriorityEl = (p: string) => {
        if (p === 'urgent') return <span className="material-symbols-outlined text-red-500 text-[16px]">error</span>;
        if (p === 'high') return <span className="material-symbols-outlined text-orange-400 text-[16px]">keyboard_double_arrow_up</span>;
        if (p === 'medium') return <span className="material-symbols-outlined text-yellow-400 text-[16px]">drag_handle</span>;
        return <span className="material-symbols-outlined text-emerald-400 text-[16px]">keyboard_double_arrow_down</span>;
    };

    if (tasks.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-24 opacity-30">
                <span className="material-symbols-outlined text-5xl mb-3">inbox</span>
                <p className="text-sm font-bold uppercase tracking-widest">No tasks found</p>
                <p className="text-xs text-text-secondary mt-1">Try clearing filters or create a new task</p>
            </div>
        );
    }

    return (
        <div className="bg-surface-dark border border-border-dark rounded-xl overflow-hidden shadow-xl animate-in fade-in duration-300">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-background-dark/50 border-b border-border-dark">
                        <th className="w-10 px-4 py-3">
                            <div
                                className={`size-4 rounded border-2 cursor-pointer flex items-center justify-center transition-all ${selectedIds.size === tasks.length && tasks.length > 0 ? 'bg-primary border-primary' : 'border-border-dark bg-background-dark'}`}
                                onClick={() => {
                                    if (selectedIds.size === tasks.length) {
                                        tasks.forEach(t => onSelectChange?.(t.id, false));
                                    } else {
                                        tasks.forEach(t => onSelectChange?.(t.id, true));
                                    }
                                }}
                            >
                                {selectedIds.size === tasks.length && tasks.length > 0 && (
                                    <span className="material-symbols-outlined text-white text-[10px]">check</span>
                                )}
                            </div>
                        </th>
                        <th className="px-4 py-3 text-[10px] font-black text-text-secondary uppercase tracking-widest w-24">
                            <SortBtn col="id" label="Key" />
                        </th>
                        <th className="px-4 py-3 text-[10px] font-black text-text-secondary uppercase tracking-widest">
                            <SortBtn col="title" label="Title" />
                        </th>
                        <th className="px-4 py-3 text-[10px] font-black text-text-secondary uppercase tracking-widest w-28">
                            <SortBtn col="priority" label="Priority" />
                        </th>
                        <th className="px-4 py-3 text-[10px] font-black text-text-secondary uppercase tracking-widest w-32">
                            <SortBtn col="status" label="Status" />
                        </th>
                        <th className="px-4 py-3 text-[10px] font-black text-text-secondary uppercase tracking-widest w-32">
                            <SortBtn col="dueDate" label="Due Date" />
                        </th>
                        <th className="px-4 py-3 text-[10px] font-black text-text-secondary uppercase tracking-widest w-36">
                            <SortBtn col="tags" label="Tags" />
                        </th>
                        <th className="px-4 py-3 text-[10px] font-black text-text-secondary uppercase tracking-widest w-12">
                            <SortBtn col="assignee" label="Assignee" />
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border-dark/30">
                    {sortedTasks.map(task => {
                        const assignee = users.find(u => u.id === task.assigneeId);
                        const dueDate = task.dueDate ? parseISO(task.dueDate) : null;
                        const overdue = dueDate && isPast(dueDate) && !isToday(dueDate);
                        const dueToday = dueDate && isToday(dueDate);

                        return (
                            <tr
                                key={task.id}
                                className={`transition-colors ${selectedIds.has(task.id) ? 'bg-primary/5' : 'hover:bg-white/[0.02]'}`}
                            >
                                {/* Checkbox */}
                                <td className={`px-4 py-3 ${isReadOnly ? '' : 'cursor-pointer'}`} onClick={e => { if (isReadOnly) return; e.stopPropagation(); onSelectChange?.(task.id, !selectedIds.has(task.id)); }}>
                                    <div className={`size-4 rounded border-2 flex items-center justify-center transition-all ${isReadOnly ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer'} ${selectedIds.has(task.id) ? 'bg-primary border-primary' : 'border-border-dark bg-background-dark opacity-0 hover:opacity-100'}`}>
                                        {selectedIds.has(task.id) && <span className="material-symbols-outlined text-white text-[10px]">check</span>}
                                    </div>
                                </td>

                                {/* ID */}
                                <td className="px-4 py-3 font-mono text-[10px] text-text-secondary cursor-pointer" onClick={() => openModal('task-detail', { task })}>
                                    {getTaskDisplayKey(task)}
                                </td>

                                {/* Title */}
                                <td className="px-4 py-3 cursor-pointer" onClick={() => openModal('task-detail', { task })}>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-white hover:text-primary transition-colors">{task.title}</span>
                                        {task.source === 'plugin' && task.sourceProvider && (
                                            <TaskSourceBadge provider={task.sourceProvider} />
                                        )}
                                        {task.subtaskCount && task.subtaskCount > 0 ? (
                                            <span className="text-[9px] font-bold text-text-secondary bg-surface-highlight px-1.5 py-0.5 rounded border border-border-dark">
                                                {task.subtaskDoneCount}/{task.subtaskCount}
                                            </span>
                                        ) : null}
                                    </div>
                                </td>

                                {/* Priority */}
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-1.5">
                                        {getPriorityEl(task.priority)}
                                        <span className="text-[10px] font-bold uppercase tracking-tighter text-text-secondary">{task.priority}</span>
                                    </div>
                                </td>

                                {/* Status — inline dropdown (read-only: badge only) */}
                                <td className="cursor-pointer px-4 py-3 relative" onClick={e => e.stopPropagation()}>
                                    <button
                                        disabled={isReadOnly}
                                        onClick={() => { if (!isReadOnly) setInlineStatusId(inlineStatusId === task.id ? null : task.id); }}
                                        className={`px-2 py-1 border rounded text-[10px] font-bold uppercase transition-all ${isReadOnly ? 'cursor-default opacity-70' : 'hover:opacity-80'} ${STATUS_COLORS[task.status]}`}
                                    >
                                        {task.status.replace('-', ' ')}
                                    </button>
                                    {!isReadOnly && inlineStatusId === task.id && (
                                        <div className="absolute left-0 top-full mt-1 bg-background-dark border border-border-dark rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in duration-100 w-36">
                                            {STATUSES.map(s => (
                                                <button
                                                    key={s}
                                                    onClick={async () => {
                                                        setInlineStatusId(null);
                                                        await updateTask(task.id, { status: s });
                                                    }}
                                                    className={`cursor-pointer w-full px-3 py-2 text-left text-[10px] font-bold uppercase hover:bg-white/5 transition-colors ${STATUS_COLORS[s].split(' ')[1]}`}
                                                >
                                                    {s.replace('-', ' ')}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </td>

                                {/* Due Date */}
                                <td className="px-4 py-3 cursor-pointer" onClick={() => openModal('task-detail', { task })}>
                                    {dueDate ? (
                                        <span className={`text-xs font-bold ${overdue ? 'text-red-400' : dueToday ? 'text-amber-400' : 'text-text-secondary'}`}>
                                            {overdue ? '⚠ ' : ''}{format(dueDate, 'MMM d, yyyy')}
                                        </span>
                                    ) : (
                                        <span className="text-[10px] text-text-secondary opacity-40">—</span>
                                    )}
                                </td>

                                {/* Tags */}
                                <td className="px-4 py-3 cursor-pointer" onClick={() => openModal('task-detail', { task })}>
                                    <div className="flex flex-wrap gap-1">
                                        {task.tags.slice(0, 2).map(tag => (
                                            <span key={tag} className="px-1.5 py-0.5 bg-surface-highlight border border-border-dark text-[9px] font-bold text-text-secondary rounded uppercase">
                                                {tag}
                                            </span>
                                        ))}
                                        {task.tags.length > 2 && (
                                            <span className="text-[9px] font-bold text-text-secondary">+{task.tags.length - 2}</span>
                                        )}
                                    </div>
                                </td>

                                {/* Assignee */}
                                <td className="px-4 py-3 cursor-pointer" onClick={() => openModal('task-detail', { task })}>
                                    {assignee?.avatar && (
                                        <div className="relative inline-flex shrink-0">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img className="size-6 rounded-full border border-border-dark" src={assignee.avatar} alt={assignee.name} title={assignee.name} />
                                            <span className="absolute -bottom-0.5 -right-0.5">
                                                <PresenceDot status={presenceFromMemberStatus(assignee.status)} size="sm" ring />
                                            </span>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
