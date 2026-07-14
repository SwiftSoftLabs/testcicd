import React from 'react';

import {
    pluginIconPath,
    type PluginIconId,
} from '@/lib/plugins/plugin-icons';

interface PluginIconProps {
    id: PluginIconId;
    size?: number;
    className?: string;
    title?: string;
}

/** Brand icon from /public/*.svg */
export function PluginIcon({ id, size = 20, className = '', title }: PluginIconProps) {
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={pluginIconPath(id)}
            alt={title ?? ''}
            width={size}
            height={size}
            className={`shrink-0 object-contain ${className}`.trim()}
            title={title}
            aria-hidden={!title}
        />
    );
}
