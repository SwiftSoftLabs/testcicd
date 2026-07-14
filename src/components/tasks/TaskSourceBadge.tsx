import React from 'react';

import type { TaskPluginProvider } from '@/lib/plugins/tasks/types';

const STYLES: Record<
    TaskPluginProvider,
    { label: string; className: string }
> = {
    trello: { label: 'Trello', className: 'bg-[#0079BF]/20 border-[#0079BF]/35 text-[#7ec8f0]' },
    jira: { label: 'Jira', className: 'bg-[#0052CC]/20 border-[#0052CC]/35 text-[#8eb4ff]' },
    clickup: { label: 'ClickUp', className: 'bg-[#7B68EE]/20 border-[#7B68EE]/35 text-[#c4b8ff]' },
    asana: { label: 'Asana', className: 'bg-[#F06A6A]/20 border-[#F06A6A]/35 text-[#ffb4b4]' },
};

export function TaskSourceBadge({ provider }: { provider: TaskPluginProvider }) {
    const style = STYLES[provider];
    return (
        <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border shrink-0 ${style.className}`}
            title={`Synced from ${style.label}`}
        >
            {style.label}
        </span>
    );
}
