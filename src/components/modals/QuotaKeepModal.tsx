'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useUIContext } from '@/context/UIContext';
import type { OverQuotaState, QuotaSelectableItem, QuotaSelectionPayload } from '@/types/billing';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

export interface QuotaKeepModalProps {
    onClose: () => void;
    workspaceId: string;
    overQuota: OverQuotaState;
    onDone?: () => void | Promise<void>;
}

type SelectableResource = 'projects' | 'channels';

interface ResourceSection {
    resource: SelectableResource;
    label: string;
    limit: number;
    used: number;
    items: QuotaSelectableItem[];
}

function sortOldestFirst<T extends { created_at: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function defaultSelection(items: QuotaSelectableItem[], limit: number): Set<string> {
    const hasLockedItems = items.some((item) => item.quota_locked);
    const unlocked = items.filter((item) => !item.quota_locked);
    if (hasLockedItems) {
        return new Set(unlocked.map((item) => item.id));
    }
    return new Set(sortOldestFirst(items).slice(0, limit).map((item) => item.id));
}

export default function QuotaKeepModal({
    onClose,
    workspaceId,
    overQuota,
    onDone,
}: QuotaKeepModalProps) {
    const modalRef = useRef<HTMLDivElement>(null);
    const { addToast } = useUIContext();
    useClickOutside(modalRef, onClose);

    const [projects, setProjects] = useState<QuotaSelectableItem[]>([]);
    const [channels, setChannels] = useState<QuotaSelectableItem[]>([]);
    const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
    const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const projectResource = overQuota.resources.find((resource) => resource.resource === 'projects');
    const channelResource = overQuota.resources.find((resource) => resource.resource === 'channels');

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            try {
                const requests: Promise<void>[] = [];

                if (projectResource) {
                    requests.push((async () => {
                        const res = await authenticatedFetch(`/api/projects?workspaceId=${workspaceId}`, { cache: 'no-store' });
                        if (!res.ok) throw new Error('Failed to load projects');
                        const rows = await res.json() as QuotaSelectableItem[];
                        const sorted = sortOldestFirst(rows);
                        if (!cancelled) {
                            setProjects(sorted);
                            setSelectedProjects(defaultSelection(sorted, projectResource.limit));
                        }
                    })());
                }

                if (channelResource) {
                    requests.push((async () => {
                        const res = await authenticatedFetch(`/api/chat/conversations?workspaceId=${workspaceId}`, { cache: 'no-store' });
                        if (!res.ok) throw new Error('Failed to load channels');
                        const body = await res.json() as { data: Array<QuotaSelectableItem & { type: string }> };
                        const rows = sortOldestFirst(
                            body.data
                                .filter((row) => row.type === 'channel')
                                .map((row) => ({
                                    id: row.id,
                                    name: row.name,
                                    created_at: row.created_at,
                                    quota_locked: row.quota_locked,
                                })),
                        );
                        if (!cancelled) {
                            setChannels(rows);
                            setSelectedChannels(defaultSelection(rows, channelResource.limit));
                        }
                    })());
                }

                await Promise.all(requests);
            } catch (error) {
                if (!cancelled) {
                    addToast(error instanceof Error ? error.message : 'Failed to load quota items', 'error');
                    onClose();
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void load();
        return () => { cancelled = true; };
    }, [workspaceId, projectResource, channelResource, addToast, onClose]);

    const sections = useMemo<ResourceSection[]>(() => {
        const next: ResourceSection[] = [];
        if (projectResource) {
            next.push({
                resource: 'projects',
                label: 'projects',
                limit: projectResource.limit,
                used: projectResource.used,
                items: projects,
            });
        }
        if (channelResource) {
            next.push({
                resource: 'channels',
                label: 'channels',
                limit: channelResource.limit,
                used: channelResource.used,
                items: channels,
            });
        }
        return next;
    }, [projectResource, channelResource, projects, channels]);

    const toggle = (resource: SelectableResource, id: string, limit: number) => {
        const setter = resource === 'projects' ? setSelectedProjects : setSelectedChannels;
        setter((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
                return next;
            }
            if (next.size >= limit) return prev;
            next.add(id);
            return next;
        });
    };

    const selectedCount = (resource: SelectableResource): number =>
        resource === 'projects' ? selectedProjects.size : selectedChannels.size;

    const isChecked = (resource: SelectableResource, id: string): boolean =>
        resource === 'projects' ? selectedProjects.has(id) : selectedChannels.has(id);

    const save = async () => {
        setSaving(true);
        try {
            const payload: QuotaSelectionPayload = {
                workspaceId,
                ...(projectResource ? { projects: Array.from(selectedProjects) } : {}),
                ...(channelResource ? { channels: Array.from(selectedChannels) } : {}),
            };

            const res = await authenticatedFetch('/api/billing/quota-selection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({ error: 'Could not save your selection' }));
                throw new Error(body.error ?? 'Could not save your selection');
            }

            addToast('Your keep-active selection has been applied.', 'success');
            await onDone?.();
            onClose();
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Could not save your selection', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            ref={modalRef}
            className="w-full max-w-3xl mx-auto max-h-[calc(100dvh-6rem)] bg-surface-dark border border-border-dark rounded-[28px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col"
        >
            <div className="px-8 py-6 border-b border-border-dark flex items-start justify-between bg-white/[0.02] shrink-0">
                <div>
                    <h2 className="text-2xl font-black text-white">Choose what to keep active</h2>
                    <p className="text-sm text-text-secondary mt-1">
                        Pick which over-limit projects and channels stay editable. Everything else becomes read-only until you upgrade or change this selection.
                    </p>
                </div>
                <button onClick={onClose} className="cursor-pointer text-text-secondary hover:text-white transition-colors">
                    <span className="material-symbols-outlined text-2xl">close</span>
                </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-8 space-y-8">
                {loading ? (
                    <div className="space-y-4 animate-pulse">
                        <div className="h-20 rounded-2xl bg-white/[0.04]" />
                        <div className="h-36 rounded-2xl bg-white/[0.04]" />
                    </div>
                ) : (
                    sections.map((section) => {
                        const count = selectedCount(section.resource);
                        return (
                            <section key={section.resource} className="space-y-4">
                                <div className="flex items-end justify-between gap-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-white">
                                            Keep {section.limit} of {section.used} {section.label} active
                                        </h3>
                                        <p className="text-xs text-text-secondary mt-1">
                                            {count} of {section.limit} selected. Leaving fewer selected is allowed and will lock more items.
                                        </p>
                                    </div>
                                    <span className="text-[11px] font-black uppercase tracking-widest text-amber-300">
                                        {count} of {section.limit}
                                    </span>
                                </div>

                                <div className="space-y-2">
                                    {section.items.map((item) => {
                                        const checked = isChecked(section.resource, item.id);
                                        const atCap = !checked && count >= section.limit;
                                        return (
                                            <label
                                                key={item.id}
                                                className={`flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 transition-colors ${
                                                    checked
                                                        ? 'border-primary/40 bg-primary/10'
                                                        : 'border-border-dark bg-background-dark/50 hover:border-white/20'
                                                } ${atCap ? 'opacity-60' : ''}`}
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-sm font-bold text-white truncate">{item.name || 'Untitled'}</p>
                                                    <p className="text-[11px] text-text-secondary mt-1">
                                                        Created {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-3 shrink-0">
                                                    {!checked && (
                                                        <span className="material-symbols-outlined text-amber-400 text-[18px]">lock</span>
                                                    )}
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggle(section.resource, item.id, section.limit)}
                                                        disabled={saving || atCap}
                                                        className="h-4 w-4 rounded border-border-dark bg-background-dark text-primary focus:ring-primary"
                                                    />
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })
                )}

                <div className="flex justify-end gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="cursor-pointer px-4 py-2 text-text-secondary text-sm font-bold hover:text-white transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={save}
                        disabled={loading || saving}
                        className="cursor-pointer px-6 py-2.5 bg-primary text-white text-sm font-black rounded-xl hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center gap-2"
                    >
                        {saving && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        {saving ? 'Applying...' : 'Apply selection'}
                    </button>
                </div>
            </div>
        </div>
    );
}
