import React from 'react';

import type { ChatPluginMessageSource } from '@/lib/plugins/chat/pluginMessage';

const STYLES: Record<
    ChatPluginMessageSource,
    { label: string; className: string; title: string }
> = {
    slack: {
        label: 'Slack',
        className: 'bg-[#4A154B]/20 border-[#4A154B]/35 text-[#d8b4e8]',
        title: 'Synced from Slack',
    },
    teams: {
        label: 'Teams',
        className: 'bg-[#464EB8]/20 border-[#464EB8]/35 text-[#b8c4f0]',
        title: 'Synced from Microsoft Teams',
    },
    discord: {
        label: 'Discord',
        className: 'bg-[#5865F2]/20 border-[#5865F2]/35 text-[#c8d0ff]',
        title: 'Synced from Discord',
    },
};

export function PluginSourceBadge({ source }: { source: ChatPluginMessageSource }) {
    const style = STYLES[source];
    return (
        <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide border shrink-0 ${style.className}`}
            title={style.title}
        >
            <span className="material-symbols-outlined text-[11px] leading-none" aria-hidden>
                sync_alt
            </span>
            {style.label}
        </span>
    );
}
