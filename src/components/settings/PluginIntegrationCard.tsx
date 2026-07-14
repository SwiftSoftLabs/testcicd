'use client';

import React from 'react';

import { PluginIcon } from '@/components/plugins/PluginIcon';
import type { PluginIconId } from '@/lib/plugins/plugin-icons';

export type PluginConnectionStatus = 'connected' | 'disconnected' | 'not_configured';

const STATUS_STYLES: Record<
    PluginConnectionStatus,
    { label: string; className: string }
> = {
    connected: {
        label: 'Connected',
        className: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/25',
    },
    disconnected: {
        label: 'Disconnected',
        className: 'bg-white/5 text-text-secondary border-border-dark',
    },
    not_configured: {
        label: 'Not configured',
        className: 'bg-amber-500/10 text-amber-400/90 border-amber-500/20',
    },
};

export interface PluginIntegrationCardProps {
    icon: PluginIconId;
    title: string;
    /** One short line — avoid paragraph-length copy in the card header */
    tagline: string;
    status: PluginConnectionStatus;
    /** Inline metadata chips (account, last sync) */
    meta?: React.ReactNode;
    errorMessage?: string;
    note?: React.ReactNode;
    actions: React.ReactNode;
    /** Channel/container links, webhook hints — shown only when relevant */
    footer?: React.ReactNode;
}

export function PluginIntegrationCard({
    icon,
    title,
    tagline,
    status,
    meta,
    errorMessage,
    note,
    actions,
    footer,
}: PluginIntegrationCardProps) {
    const statusStyle = STATUS_STYLES[status];

    return (
        <article className="overflow-hidden rounded-xl border border-border-dark bg-surface-dark">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-1 gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border-dark bg-background-dark">
                        <PluginIcon id={icon} size={26} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h5 className="text-[15px] font-semibold text-white leading-tight">{title}</h5>
                            <span
                                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyle.className}`}
                            >
                                {statusStyle.label}
                            </span>
                        </div>
                        <p className="mt-1 text-sm leading-snug text-text-secondary">{tagline}</p>
                        {meta && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                                {meta}
                            </div>
                        )}
                        {errorMessage && (
                            <p className="mt-2 text-xs font-medium text-amber-400">{errorMessage}</p>
                        )}
                        {note && <div className="mt-2 text-xs text-violet-300/90">{note}</div>}
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-0.5">{actions}</div>
            </div>
            {footer && (
                <div className="border-t border-border-dark bg-background-dark/40 px-4 py-3">{footer}</div>
            )}
        </article>
    );
}

export function PluginMetaItem({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className="text-text-secondary/70">{label}</span>
            <span className="font-medium text-text-main">{children}</span>
        </span>
    );
}

export function PluginSection({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="space-y-3">
            <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary">{title}</h4>
                {description && (
                    <p className="mt-1 max-w-2xl text-sm text-text-secondary">{description}</p>
                )}
            </div>
            <div className="flex flex-col gap-3">{children}</div>
        </section>
    );
}

export const pluginBtnPrimary =
    'inline-flex items-center justify-center rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50';

export const pluginBtnSecondary =
    'inline-flex items-center justify-center rounded-lg border border-border-dark px-3.5 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-border-dark/80 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50';

export const pluginBtnGhost =
    'inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50';

/** Placeholder while plugin connection status is loading */
export function PluginIntegrationCardSkeleton() {
    return (
        <div
            className="animate-pulse overflow-hidden rounded-xl border border-border-dark bg-surface-dark p-4"
            aria-hidden
        >
            <div className="flex gap-3 sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-1 gap-3">
                    <div className="size-11 shrink-0 rounded-lg bg-white/8" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex gap-2">
                            <div className="h-4 w-32 rounded bg-white/10" />
                            <div className="h-4 w-20 rounded bg-white/6" />
                        </div>
                        <div className="h-3 w-full max-w-md rounded bg-white/6" />
                        <div className="flex gap-3">
                            <div className="h-3 w-24 rounded bg-white/5" />
                            <div className="h-3 w-28 rounded bg-white/5" />
                        </div>
                    </div>
                </div>
                <div className="hidden gap-2 sm:flex">
                    <div className="h-8 w-20 rounded-lg bg-white/8" />
                    <div className="h-8 w-24 rounded-lg bg-white/6" />
                </div>
            </div>
        </div>
    );
}

export function PluginsStatusLoading({
    label = 'Checking plugin connections…',
    count = 3,
}: {
    label?: string;
    count?: number;
}) {
    return (
        <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
            <p className="flex items-center gap-2 text-sm text-text-secondary">
                <span className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                {label}
            </p>
            {Array.from({ length: count }, (_, i) => (
                <PluginIntegrationCardSkeleton key={i} />
            ))}
        </div>
    );
}
