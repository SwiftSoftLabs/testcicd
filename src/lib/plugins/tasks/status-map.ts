import type { Priority, Status } from '@/types';

import type { NormalizedPluginTask } from './types';

const DONE_PATTERNS = /done|complete|closed|resolved|shipped|archive/i;
const PROGRESS_PATTERNS = /progress|doing|active|review|testing|development|dev/i;
const BACKLOG_PATTERNS = /backlog|icebox|later|hold|waiting/i;

export function mapExternalStatus(
    task: NormalizedPluginTask,
    statusMap: Record<string, string> = {},
): Status {
    const raw = task.externalStatus?.trim();
    if (raw && statusMap[raw]) {
        const mapped = statusMap[raw] as Status;
        if (isValidStatus(mapped)) return mapped;
    }
    if (task.statusCategory === 'done') return 'done';
    if (task.statusCategory === 'in_progress') return 'in-progress';
    if (task.statusCategory === 'todo') return 'todo';
    if (raw) {
        if (DONE_PATTERNS.test(raw)) return 'done';
        if (PROGRESS_PATTERNS.test(raw)) return 'in-progress';
        if (BACKLOG_PATTERNS.test(raw)) return 'backlog';
    }
    return 'todo';
}

export function mapExternalPriority(value?: string): Priority {
    const v = (value ?? '').toLowerCase();
    if (v.includes('urgent') || v.includes('highest') || v.includes('critical')) return 'urgent';
    if (v.includes('high')) return 'high';
    if (v.includes('low') || v.includes('lowest')) return 'low';
    return 'medium';
}

function isValidStatus(s: string): s is Status {
    return ['backlog', 'todo', 'in-progress', 'review', 'done'].includes(s);
}

const DEFAULT_OUTBOUND_STATUS: Record<Status, string> = {
    backlog: 'Backlog',
    todo: 'To Do',
    'in-progress': 'In Progress',
    review: 'In Review',
    done: 'Done',
};

/** Map a OneWork status to an external provider status name for outbound sync. */
export function mapOneWorkStatusToExternal(
    status: Status,
    statusMap: Record<string, string> = {},
): string {
    if (statusMap[status]) return statusMap[status];
    const fromImport = Object.entries(statusMap).find(([, mapped]) => mapped === status);
    if (fromImport) return fromImport[0];
    return DEFAULT_OUTBOUND_STATUS[status] ?? status;
}
