'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import { useUIContext } from '@/context/UIContext';
import { api } from '@/lib/api';
import type { PermissionKey } from '@/lib/rbac/permissions';
import { WORKSPACE_ROLES, type WorkspaceRole } from '@/lib/rbac/roles';

interface MatrixRow {
    id: PermissionKey;
    name: string;
    description: string;
    section: string;
    roles: Record<WorkspaceRole, boolean>;
}

const ROLE_COLUMNS: { key: WorkspaceRole; label: string; icon: string; color: string }[] = [
    { key: 'admin', label: 'ADMIN', icon: 'verified_user', color: 'text-orange-400' },
    { key: 'team_lead', label: 'TEAM LEAD', icon: 'edit', color: 'text-blue-400' },
    { key: 'member', label: 'MEMBER', icon: 'person', color: 'text-slate-400' },
    { key: 'guest', label: 'GUEST', icon: 'visibility', color: 'text-slate-400' },
];

const PermissionsSettings = () => {
    const { addToast } = useUIContext();
    const { selectedWorkspaceId } = useAppContext();
    const [matrix, setMatrix] = useState<MatrixRow[]>([]);
    const [canManage, setCanManage] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!selectedWorkspaceId) return;
        setLoading(true);
        try {
            const res = await api.rbac.get(selectedWorkspaceId);
            setMatrix(res.data.matrix as MatrixRow[]);
            setCanManage(res.data.canManage);
        } catch {
            addToast('Failed to load permissions.', 'error');
        } finally {
            setLoading(false);
        }
    }, [selectedWorkspaceId, addToast]);

    useEffect(() => {
        void load();
    }, [load]);

    const handleToggle = async (permission: PermissionKey, role: WorkspaceRole) => {
        if (!selectedWorkspaceId || !canManage) return;
        const row = matrix.find((r) => r.id === permission);
        if (!row) return;
        const next = !row.roles[role];
        setSaving(true);
        try {
            await api.rbac.updateRole(selectedWorkspaceId, {
                role,
                permissions: { [permission]: next },
            });
            setMatrix((prev) =>
                prev.map((item) =>
                    item.id === permission
                        ? { ...item, roles: { ...item.roles, [role]: next } }
                        : item,
                ),
            );
            addToast(`"${row.name}" ${next ? 'enabled' : 'disabled'} for ${role.replace('_', ' ')}.`, 'info');
        } catch (err: unknown) {
            addToast(err instanceof Error ? err.message : 'Failed to update permission.', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleExport = () => {
        const headers = ['Category', 'Permission', 'Description', ...ROLE_COLUMNS.map((c) => c.label)];
        const rows = matrix.map((item) => [
            item.section,
            item.name,
            item.description,
            ...WORKSPACE_ROLES.map((r) => (item.roles[r] ? 'Yes' : 'No')),
        ]);
        const csvContent = [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'permissions_matrix.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        addToast('Permissions matrix exported.', 'success');
    };

    if (loading) {
        return <p className="text-sm text-text-secondary">Loading permissions…</p>;
    }

    const sections = [...new Set(matrix.map((m) => m.section))];

    return (
        <div className="min-w-0 max-w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-2xl font-black text-white tracking-tight leading-tight">Permissions Matrix</h2>
                    <p className="text-text-secondary text-sm">Capabilities for each built-in workspace role.</p>
                </div>
                <button
                    type="button"
                    onClick={handleExport}
                    className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-surface-dark border border-border-dark text-white text-xs font-bold rounded-lg hover:bg-white/5 transition-all shadow-sm active:scale-95"
                >
                    <span className="material-symbols-outlined text-sm">download</span> Export CSV
                </button>
            </div>

            {!canManage && (
                <p className="text-xs text-amber-400/90 border border-amber-500/20 bg-amber-500/5 rounded-xl px-4 py-3">
                    View only — changes require Manage Roles &amp; Permissions.
                </p>
            )}

            <section className="max-w-full overflow-x-auto rounded-2xl border border-border-dark bg-surface-dark shadow-sm">
                <table className="w-full min-w-[720px] text-left">
                    <thead className="bg-background-dark/30 border-b border-border-dark">
                        <tr>
                            <th className="px-6 py-5 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] w-1/2">Permission Name</th>
                            {ROLE_COLUMNS.map((col) => (
                                <th key={col.key} className="px-6 py-5 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] text-center">
                                    <span className={`flex items-center justify-center gap-2 ${col.color}`}>
                                        <span className="material-symbols-outlined text-sm">{col.icon}</span>
                                        {col.label}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border-dark">
                        {sections.map((section) => (
                            <React.Fragment key={section}>
                                <tr className="bg-background-dark/10">
                                    <td colSpan={5} className="px-6 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-text-secondary text-sm">
                                                {section.includes('WORKSPACE') ? 'business' : section.includes('PROJECT') ? 'folder_open' : section.includes('VERSION') ? 'call_split' : 'chat'}
                                            </span>
                                            <span className="text-[10px] font-black text-text-secondary uppercase tracking-widest">{section}</span>
                                        </div>
                                    </td>
                                </tr>
                                {matrix
                                    .filter((item) => item.section === section)
                                    .map((item) => (
                                        <tr key={item.id} className="hover:bg-white/[0.01] transition-all group">
                                            <td className="px-6 py-5">
                                                <h4 className="text-sm font-bold text-white group-hover:text-primary transition-colors">{item.name}</h4>
                                                <p className="text-xs text-text-secondary">{item.description}</p>
                                            </td>
                                            {ROLE_COLUMNS.map((col) => (
                                                <td key={col.key} className="px-6 py-5 text-center">
                                                    <button
                                                        type="button"
                                                        disabled={!canManage || saving}
                                                        onClick={() => void handleToggle(item.id, col.key)}
                                                        className={`cursor-pointer material-symbols-outlined transition-all hover:scale-125 disabled:opacity-30 ${item.roles[col.key] ? 'text-emerald-400' : 'text-text-secondary/20'}`}
                                                    >
                                                        {item.roles[col.key] ? 'check_circle' : 'circle'}
                                                    </button>
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </section>
        </div>
    );
};

export default PermissionsSettings;
