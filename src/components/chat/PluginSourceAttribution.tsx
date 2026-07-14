import React from 'react';

import { PluginIcon } from '@/components/plugins/PluginIcon';
import type { ChatPluginMessageSource } from '@/lib/plugins/chat/pluginMessage';
import { chatPluginIconId } from '@/lib/plugins/plugin-icons';

const LABELS: Record<ChatPluginMessageSource, string> = {
    slack: 'Slack',
    teams: 'Teams',
    discord: 'Discord',
};

/** Small brand attribution on synced messages (icon + label, no border). */
export function PluginSourceAttribution({ source }: { source: ChatPluginMessageSource }) {
    const label = LABELS[source];
    return (
        <span
            className="inline-flex items-center gap-1 rounded-md bg-white/4 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary/80"
            title={`Synced from ${label}`}
        >
            <PluginIcon id={chatPluginIconId(source)} size={14} className="opacity-90" />
            <span>{label}</span>
        </span>
    );
}
