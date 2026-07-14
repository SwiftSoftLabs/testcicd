'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import { useUIContext } from '@/context/UIContext';
import { api } from '@/lib/api';
import { PERMISSION_GROUPS, permissionLabel, type PermissionKey } from '@/lib/rbac/permissions';
import type { WorkspaceRole } from '@/lib/rbac/roles';

interface RoleRow {
    key: WorkspaceRole;
    label: string;
    description: string;
    active: boolean;
    permissions: Record<PermissionKey, boolean>;
}

const RolesSettings = () => {
    const { addToast } = useUIContext();
    const { selectedWorkspaceId } = useAppContext();
    const [roles, setRoles] = useState<RoleRow[]>([]);
    const [activeRoleId, setActiveRoleId] = useState<WorkspaceRole>('admin');
    const [canManage, setCanManage] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!selectedWorkspaceId) return;
        setLoading(true);
        try {
            const res = await api.rbac.get(selectedWorkspaceId);
            const list = res.data.roles as RoleRow[];
            setRoles(list);
            setCanManage(res.data.canManage);
            setActiveRoleId((prev) => (list.some((r) => r.key === prev) ? prev : list[0]?.key ?? 'admin'));
        } catch {
            addToast('Failed to load roles.', 'error');
        } finally {
            setLoading(false);
        }
    }, [selectedWorkspaceId, addToast]);

    useEffect(() => {
        void load();
    }, [load]);

    const activeRole = useMemo(
        () => roles.find((r) => r.key === activeRoleId) ?? roles[0],
        [roles, activeRoleId],
    );

    const persistRole = async (patch: Parameters<typeof api.rbac.updateRole>[1]) => {
        if (!selectedWorkspaceId || !canManage) return;
        setSaving(true);
        try {
            await api.rbac.updateRole(selectedWorkspaceId, patch);
            await load();
        } catch (err: unknown) {
            addToast(err instanceof Error ? err.message : 'Failed to save role.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleTogglePermGroup = (groupPermissions: readonly PermissionKey[], enabled: boolean) => {
        if (!activeRole || !canManage) return;
        const next: Partial<Record<PermissionKey, boolean>> = {};
        for (const key of groupPermissions) next[key] = enabled;
        void persistRole({ role: activeRole.key, permissions: next });
        addToast(`Permission group ${enabled ? 'enabled' : 'disabled'} for ${activeRole.label}`, 'info');
    };

    const handleTogglePerm = (key: PermissionKey, enabled: boolean) => {
        if (!activeRole || !canManage) return;
        void persistRole({ role: activeRole.key, permissions: { [key]: enabled } });
    };

    if (loading) {
        return <p className="text-sm text-text-secondary">Loading roles…</p>;
    }

    if (!activeRole) {
        return <p className="text-sm text-text-secondary">No workspace selected.</p>;
    }

    return (
        <div className="min-w-0 max-w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-black text-white tracking-tight leading-tight">Role Management</h2>
                    <p className="text-text-secondary text-sm">
                        Built-in workspace roles. Customize labels and permissions per role.
                    </p>
                </div>
            </div>

            {!canManage && (
                <p className="text-xs text-amber-400/90 border border-amber-500/20 bg-amber-500/5 rounded-xl px-4 py-3">
                    View only — you need Manage Roles &amp; Permissions to edit.
                </p>
            )}

            <div className="flex flex-wrap gap-2 border-b border-border-dark pb-2 overflow-x-auto no-scrollbar scroll-smooth">
                {roles.map((r) => (
                    <button
                        key={r.key}
                        type="button"
                        disabled={!r.active}
                        onClick={() => setActiveRoleId(r.key)}
                        className={`cursor-pointer px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeRoleId === r.key ? 'bg-primary/10 text-primary border border-primary/20 shadow-sm' : 'text-text-secondary hover:text-white hover:bg-white/5'} ${!r.active ? 'opacity-40' : ''}`}
                    >
                        {r.label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-6">
                <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm theme-transition">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-white">Role Details</h3>
                        <button
                            type="button"
                            disabled={!canManage || saving}
                            onClick={() => void persistRole({ role: activeRole.key, active: !activeRole.active })}
                            className={`cursor-pointer px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${activeRole.active ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}
                        >
                            {activeRole.active ? 'Active' : 'Inactive'}
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Display name</label>
                            <input
                                type="text"
                                disabled={!canManage}
                                defaultValue={activeRole.label}
                                key={`label-${activeRole.key}`}
                                onBlur={(e) => {
                                    const v = e.target.value.trim();
                                    if (v && v !== activeRole.label) void persistRole({ role: activeRole.key, label: v });
                                }}
                                className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-2.5 transition-all outline-none disabled:opacity-50"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Description</label>
                            <input
                                type="text"
                                disabled={!canManage}
                                defaultValue={activeRole.description}
                                key={`desc-${activeRole.key}`}
                                onBlur={(e) => {
                                    const v = e.target.value.trim();
                                    if (v !== activeRole.description) void persistRole({ role: activeRole.key, description: v });
                                }}
                                className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-2.5 transition-all outline-none disabled:opacity-50"
                            />
                        </div>
                    </div>
                </section>

                <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm theme-transition">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6 sm:mb-8">
                        <h3 className="text-lg font-bold text-white">Permissions Configuration</h3>
                        {canManage && (
                            <div className="flex gap-4">
                                <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => {
                                        const all: Partial<Record<PermissionKey, boolean>> = {};
                                        for (const g of PERMISSION_GROUPS) {
                                            for (const p of g.permissions) all[p] = true;
                                        }
                                        void persistRole({ role: activeRole.key, permissions: all });
                                    }}
                                    className="cursor-pointer text-[10px] font-black text-text-secondary uppercase tracking-widest hover:text-white transition-colors"
                                >
                                    Select All
                                </button>
                                <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => void persistRole({ role: activeRole.key, resetRole: true })}
                                    className="cursor-pointer text-[10px] font-black text-primary uppercase tracking-widest hover:underline transition-colors"
                                >
                                    Reset to Default
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="space-y-6">
                        {PERMISSION_GROUPS.map((group) => {
                            const groupEnabled = group.permissions.every((p) => activeRole.permissions[p]);
                            return (
                                <div
                                    key={group.title}
                                    className={`bg-background-dark/30 border rounded-2xl p-4 sm:p-5 md:p-6 transition-all ${groupEnabled ? 'border-primary/40 bg-primary/5 shadow-lg shadow-primary/5' : 'border-border-dark opacity-70 grayscale-[0.5]'}`}
                                >
                                    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="flex min-w-0 flex-1 gap-4 items-start">
                                            <div className={`size-10 rounded-xl flex items-center justify-center border transition-all ${groupEnabled ? 'bg-primary border-primary text-white shadow-lg shadow-primary/30' : 'bg-surface-highlight border-border-dark text-text-secondary'}`}>
                                                <span className="material-symbols-outlined">{group.icon}</span>
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-bold text-white">{group.title}</h4>
                                                <p className="text-[10px] text-text-secondary uppercase font-medium tracking-wider">{group.description}</p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={!canManage || saving}
                                            onClick={() => handleTogglePermGroup(group.permissions, !groupEnabled)}
                                            className={`cursor-pointer relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 ${groupEnabled ? 'bg-primary' : 'bg-slate-700'}`}
                                        >
                                            <span className={`absolute top-1 size-4 rounded-full bg-white shadow-sm transition-all duration-300 ${groupEnabled ? 'left-6' : 'left-1'}`} />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 pl-0 sm:pl-14">
                                        {group.permissions.map((p) => (
                                            <label key={p} className="flex items-center gap-3 group/item cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    disabled={!canManage || saving}
                                                    checked={activeRole.permissions[p]}
                                                    onChange={(e) => handleTogglePerm(p, e.target.checked)}
                                                    className="size-4 rounded border-border-dark bg-surface-dark text-primary focus:ring-offset-background-dark disabled:opacity-30 cursor-pointer"
                                                />
                                                <span className={`text-xs transition-colors ${activeRole.permissions[p] ? 'text-text-secondary group-hover/item:text-white' : 'text-text-secondary/40'}`}>
                                                    {permissionLabel(p)}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default RolesSettings;
