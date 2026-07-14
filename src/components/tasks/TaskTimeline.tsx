'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useUIContext } from '@/context/UIContext';
import { Sprint, Task, User } from '@/types';
import { getTaskDisplayKey } from '@/lib/tasks/taskKey';
import {
    addDays, addMonths, differenceInCalendarDays,
    eachMonthOfInterval, format, getISOWeek,
    isSameMonth, isToday, isPast,
    parseISO, startOfDay,
} from 'date-fns';
import PresenceDot from '@/components/PresenceDot';
import { presenceFromMemberStatus } from '@/lib/presence';

type ViewMode = 'daily' | 'weekly' | 'monthly';

interface TaskTimelineProps {
    tasks: Task[];
    users: User[];
    sprints: Sprint[];
    selectedSprintId: string | null;
    isReadOnly?: boolean;
}

const COL_WIDTHS: Record<ViewMode, number> = { daily: 48, weekly: 112, monthly: 140 };
const TASK_COL_W = 256;
const SPRINT_DAY_OPTIONS = [7, 14, 21, 30, 45, 60];

export const TaskTimeline: React.FC<TaskTimelineProps> = ({ tasks, users, sprints, selectedSprintId, isReadOnly = false }) => {
    const { openModal } = useUIContext();

    const [viewMode, setViewMode] = useState<ViewMode>('daily');
    const [viewStart, setViewStart] = useState<Date>(() => startOfDay(new Date()));
    const [sprintDays, setSprintDays] = useState(30);

    useEffect(() => {
        if (!selectedSprintId) return;
        const sprint = sprints.find(s => s.id === selectedSprintId);
        if (!sprint) return;
        if (sprint.start_date) setViewStart(startOfDay(parseISO(sprint.start_date)));
        const len = sprint.duration_days
            ?? (sprint.start_date && sprint.end_date
                ? differenceInCalendarDays(parseISO(sprint.end_date), parseISO(sprint.start_date)) + 1
                : null);
        if (len) setSprintDays(Math.max(7, len));
    }, [selectedSprintId, sprints]);

    const COL_WIDTH = COL_WIDTHS[viewMode];

    const cols = useMemo(() => {
        if (viewMode === 'daily')
            return Array.from({ length: sprintDays }, (_, i) => addDays(viewStart, i));
        if (viewMode === 'weekly')
            return Array.from({ length: Math.ceil(sprintDays / 7) }, (_, i) => addDays(viewStart, i * 7));
        return eachMonthOfInterval({ start: viewStart, end: addDays(viewStart, Math.max(sprintDays, 60) - 1) });
    }, [viewMode, viewStart, sprintDays]);

    const navigate = (dir: 1 | -1) => {
        if (viewMode === 'daily') setViewStart(d => addDays(d, dir * sprintDays));
        else if (viewMode === 'weekly') setViewStart(d => addDays(d, dir * Math.ceil(sprintDays / 7) * 7));
        else setViewStart(d => addMonths(d, dir * cols.length));
    };

    const jumpToSprint = (sprintId: string) => {
        if (!sprintId) return;
        const sprint = sprints.find(s => s.id === sprintId);
        if (!sprint) return;
        if (sprint.start_date) setViewStart(startOfDay(parseISO(sprint.start_date)));
        const len = sprint.duration_days
            ?? (sprint.start_date && sprint.end_date
                ? differenceInCalendarDays(parseISO(sprint.end_date), parseISO(sprint.start_date)) + 1
                : null);
        if (len) setSprintDays(Math.max(7, len));
    };

    const today = startOfDay(new Date());

    const isColToday = (col: Date) => {
        if (viewMode === 'daily') return isToday(col);
        if (viewMode === 'weekly') return today >= col && today <= addDays(col, 6);
        return isSameMonth(col, today);
    };

    const todayColIdx = viewMode === 'daily'
        ? differenceInCalendarDays(today, viewStart)
        : -1;

    const getBar = (task: Task) => {
        if (!task.dueDate) return null;
        const due = startOfDay(parseISO(task.dueDate));
        let colIdx = -1;
        if (viewMode === 'daily') colIdx = differenceInCalendarDays(due, viewStart);
        else if (viewMode === 'weekly') colIdx = Math.floor(differenceInCalendarDays(due, viewStart) / 7);
        else colIdx = cols.findIndex(c => isSameMonth(c, due));
        if (colIdx < 0 || colIdx >= cols.length) return null;
        const overdue = isPast(due) && !isToday(due) && task.status !== 'done';
        return { colIdx, overdue };
    };

    const colHeader = (col: Date) => {
        if (viewMode === 'daily') return { top: format(col, 'EEE'), bottom: format(col, 'd') };
        if (viewMode === 'weekly') return { top: `W${getISOWeek(col)}`, bottom: format(col, 'MMM d') };
        return { top: format(col, 'MMM'), bottom: format(col, 'yyyy') };
    };

    const navLabel = () => {
        if (viewMode === 'monthly') {
            const last = addMonths(viewStart, cols.length - 1);
            return `${format(viewStart, 'MMM')} – ${format(last, 'MMM yyyy')}`;
        }
        if (viewMode === 'weekly') {
            const lastWeekStart = addDays(viewStart, (cols.length - 1) * 7);
            return `W${getISOWeek(viewStart)} – W${getISOWeek(lastWeekStart)}, ${format(viewStart, 'yyyy')}`;
        }
        return `${format(viewStart, 'MMM d')} – ${format(addDays(viewStart, sprintDays - 1), 'MMM d, yyyy')}`;
    };

    const scheduledTasks = tasks.filter(t => t.dueDate);
    const unscheduledTasks = tasks.filter(t => !t.dueDate);
    const totalWidth = TASK_COL_W + cols.length * COL_WIDTH;

    const taskRowLeft = (
        task: Task,
        extra?: string,
    ) => (
        <div
            className={`shrink-0 sticky left-0 z-10 bg-background-dark border-r border-border-dark px-4 flex flex-col justify-center gap-0.5 ${extra ?? ''}`}
            style={{ width: TASK_COL_W }}
        >
            <span className="text-[9px] font-mono text-text-secondary">{getTaskDisplayKey(task)}</span>
            <span
                className="text-xs font-bold text-white truncate group-hover:text-primary transition-colors cursor-pointer"
                onClick={() => openModal('task-detail', { task })}
            >
                {task.title}
            </span>
        </div>
    );

    return (
        <div className="flex flex-col h-full bg-surface-dark/20 rounded-2xl border border-border-dark animate-in fade-in duration-300">
            {/* Toolbar */}
            <div className="shrink-0 px-4 py-2.5 border-b border-border-dark bg-background-dark/60 flex items-center gap-3 flex-wrap rounded-t-2xl">
                {sprints.length > 0 && (
                    <select
                        defaultValue=""
                        onChange={e => jumpToSprint(e.target.value)}
                        className="bg-surface-dark border border-border-dark rounded-lg text-[11px] text-text-secondary px-2 py-1 outline-none focus:ring-1 focus:ring-primary cursor-pointer [color-scheme:dark]"
                    >
                        <option value="">Jump to sprint…</option>
                        {sprints.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                )}

                <div className="h-4 w-px bg-border-dark" />

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => navigate(-1)}
                        className="cursor-pointer p-1 rounded-lg hover:bg-white/5 text-text-secondary hover:text-white transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                    </button>
                    <span className="text-[11px] font-bold text-white px-2 min-w-[190px] text-center">{navLabel()}</span>
                    <button
                        onClick={() => navigate(1)}
                        className="cursor-pointer p-1 rounded-lg hover:bg-white/5 text-text-secondary hover:text-white transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                    </button>
                </div>

                <div className="h-4 w-px bg-border-dark" />

                <div className="flex rounded-lg border border-border-dark overflow-hidden">
                    {(['daily', 'weekly', 'monthly'] as ViewMode[]).map(m => (
                        <button
                            key={m}
                            onClick={() => setViewMode(m)}
                            className={`cursor-pointer px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${viewMode === m ? 'bg-primary text-white' : 'text-text-secondary hover:text-white hover:bg-white/5'}`}
                        >
                            {m}
                        </button>
                    ))}
                </div>

                <div className="h-4 w-px bg-border-dark" />

                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Range</span>
                    <select
                        value={sprintDays}
                        onChange={e => setSprintDays(Number(e.target.value))}
                        className="bg-surface-dark border border-border-dark rounded-lg text-[11px] text-white px-2 py-1 outline-none focus:ring-1 focus:ring-primary [color-scheme:dark]"
                    >
                        {SPRINT_DAY_OPTIONS.map(d => (
                            <option key={d} value={d}>{d}d</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Scrollable grid */}
            <div className="flex-1 overflow-auto custom-scrollbar">
                <div style={{ minWidth: totalWidth }}>
                    {/* Sticky header row */}
                    <div className="flex sticky top-0 z-20 border-b border-border-dark bg-background-dark">
                        <div
                            className="shrink-0 sticky left-0 z-30 bg-background-dark border-r border-border-dark px-4 py-3"
                            style={{ width: TASK_COL_W }}
                        >
                            <span className="text-[10px] font-black text-text-secondary uppercase tracking-widest">Tasks</span>
                        </div>
                        <div className="flex">
                            {cols.map((col, i) => (
                                <div
                                    key={i}
                                    style={{ minWidth: COL_WIDTH, width: COL_WIDTH }}
                                    className={`p-2 text-center border-r border-border-dark/30 last:border-r-0 ${isColToday(col) ? 'bg-primary/10' : ''}`}
                                >
                                    <div className="text-[8px] font-black text-text-secondary uppercase">{colHeader(col).top}</div>
                                    <div className={`text-[10px] font-bold ${isColToday(col) ? 'text-primary' : 'text-white'}`}>{colHeader(col).bottom}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Scheduled task rows */}
                    {scheduledTasks.map(task => {
                        const bar = getBar(task);
                        const assignee = users.find(u => u.id === task.assigneeId);
                        return (
                            <div key={task.id} className="flex border-b border-border-dark/30 hover:bg-white/[0.02] transition-colors group h-14">
                                {taskRowLeft(task)}
                                <div className="relative" style={{ width: cols.length * COL_WIDTH, minWidth: cols.length * COL_WIDTH }}>
                                    {cols.map((col, i) => (
                                        <div
                                            key={i}
                                            className={`absolute top-0 bottom-0 border-r border-border-dark/20 ${isColToday(col) ? 'bg-primary/5' : ''}`}
                                            style={{ left: i * COL_WIDTH, width: COL_WIDTH }}
                                        />
                                    ))}
                                    {viewMode === 'daily' && todayColIdx >= 0 && todayColIdx < cols.length && (
                                        <div
                                            className="absolute top-0 bottom-0 w-px bg-primary/40 z-10 pointer-events-none"
                                            style={{ left: (todayColIdx + 0.5) * COL_WIDTH }}
                                        />
                                    )}
                                    {bar && (
                                        <div
                                            className={`absolute top-1/2 -translate-y-1/2 h-8 rounded-lg flex items-center gap-2 px-2 transition-all z-20 ${isReadOnly ? 'cursor-default' : 'cursor-pointer hover:brightness-110'} ${bar.overdue ? 'bg-red-500/80 border border-red-500' : task.status === 'done' ? 'bg-emerald-600/80 border border-emerald-500' : 'bg-primary/80 border border-primary'}`}
                                            style={{ left: bar.colIdx * COL_WIDTH + 2, width: COL_WIDTH - 4 }}
                                            onClick={() => openModal('task-detail', { task })}
                                            title={task.title}
                                        >
                                            {assignee?.avatar && (
                                                <div className="relative inline-flex shrink-0">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={assignee.avatar} className="size-4 rounded-full border border-white/20 shrink-0" alt="" />
                                                    <span className="absolute -bottom-0.5 -right-0.5">
                                                        <PresenceDot status={presenceFromMemberStatus(assignee.status)} size="sm" ring />
                                                    </span>
                                                </div>
                                            )}
                                            <span className="text-[9px] font-bold text-white truncate">
                                                {format(parseISO(task.dueDate!), 'MMM d')}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* Unscheduled section */}
                    {unscheduledTasks.length > 0 && (
                        <>
                            <div className="flex border-b border-border-dark/50 bg-background-dark/30 px-4 py-2">
                                <span className="text-[10px] font-black text-text-secondary uppercase tracking-widest">
                                    Unscheduled ({unscheduledTasks.length})
                                </span>
                            </div>
                            {unscheduledTasks.map(task => (
                                <div key={task.id} className="flex border-b border-border-dark/30 hover:bg-white/[0.02] transition-colors group h-14">
                                    {taskRowLeft(task)}
                                    <div className="flex items-center px-6" style={{ width: cols.length * COL_WIDTH }}>
                                        <span className="text-[10px] text-text-secondary opacity-40 italic">No due date set</span>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}

                    {tasks.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-24 opacity-20">
                            <span className="material-symbols-outlined text-5xl mb-3">timeline</span>
                            <p className="text-sm font-bold uppercase tracking-widest">No tasks to display</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
