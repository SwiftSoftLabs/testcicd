'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';
import type { PermissionKey } from '@/lib/rbac/permissions';

export default function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const { can, loading: permsLoading } = useWorkspacePermissions();

    const menuItems = useMemo(() => {
        const all: { label: string; icon: string; path: string; requires?: PermissionKey }[] = [
            { label: 'Account', icon: 'manage_accounts', path: '/settings/account' },
            { label: 'Profile', icon: 'person', path: '/settings/profile' },
            { label: 'User Management', icon: 'group', path: '/settings/users' },
            { label: 'Roles', icon: 'assignment_ind', path: '/settings/roles' },
            { label: 'Permissions', icon: 'key', path: '/settings/permissions' },
            { label: 'Git & SSH', icon: 'terminal', path: '/settings/git-ssh' },
            { label: 'Workspace', icon: 'workspaces', path: '/settings/workspace' },
            { label: 'Notifications', icon: 'notifications', path: '/settings/notifications' },
            { label: 'Plugins', icon: 'electrical_services', path: '/settings/plugins' },
            { label: 'Billing & Plans', icon: 'credit_card', path: '/settings/billing', requires: 'billing_management' },
            { label: 'Activity Logs', icon: 'history', path: '/settings/activity-logs', requires: 'view_audit_logs' },
        ];
        if (permsLoading) return all.filter((item) => !item.requires);
        return all.filter((item) => !item.requires || can(item.requires));
    }, [can, permsLoading]);

    const getIsActive = (path: string) => {
        if (path === '/settings/account') {
            return pathname === '/settings' || pathname === '/settings/account';
        }
        return pathname === path;
    };

    return (
        <div className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-background-dark">
            {/* Header — always visible, never scrolls away */}
            <div className="w-full shrink-0 px-4 sm:px-6 xl:px-10 pt-5 sm:pt-7 pb-4 sm:pb-5">
                <div className="mx-auto w-full max-w-[1240px]">
                    <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-1">Settings</h1>
                    <p className="text-sm text-text-secondary">Manage your account preferences, security, and workspace configuration.</p>
                </div>
            </div>

            {/* Card — fills all remaining height */}
            <div className="flex min-h-0 w-full flex-1 flex-col px-4 sm:px-6 xl:px-10 pb-4 sm:pb-6">
                <div className="mx-auto flex h-full w-full min-w-0 max-w-[1240px] flex-col overflow-hidden rounded-2xl border border-border-dark bg-surface-dark/40 shadow-[0_12px_36px_rgba(2,6,23,0.45)] xl:flex-row">

                    {/* ── Mobile dropdown (< 640px) ── */}
                    <div className="block sm:hidden shrink-0 p-3 border-b border-border-dark">
                        <div className="relative">
                            <select
                                value={pathname || ''}
                                onChange={(e) => router.push(e.target.value)}
                                aria-label="Settings section"
                                className="w-full appearance-none bg-surface-dark border border-border-dark text-main text-sm font-bold rounded-xl pl-4 pr-10 py-2.5 focus:ring-1 focus:ring-primary outline-none"
                            >
                                {menuItems.map(item => (
                                    <option key={item.path} value={item.path}>{item.label}</option>
                                ))}
                            </select>
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary pointer-events-none">expand_more</span>
                        </div>
                    </div>

                    {/* ── Tablet/small-desktop tab strip (640px – 1279px) — single row, scrollable ── */}
                    <div className="hidden sm:flex xl:hidden shrink-0 items-stretch border-b border-border-dark overflow-x-auto no-scrollbar">
                        {menuItems.map(item => {
                            const isActive = getIsActive(item.path);
                            return (
                                <Link
                                    key={item.path}
                                    href={item.path}
                                    className={`flex items-center gap-2 px-4 py-3 text-sm font-bold transition-all whitespace-nowrap border-b-2 -mb-px ${isActive
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-text-secondary hover:text-main hover:border-border-dark'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-[17px]">{item.icon}</span>
                                    {item.label}
                                </Link>
                            );
                        })}
                    </div>

                    {/* ── Desktop sidebar nav (≥ 1280px) ── */}
                    <nav className="hidden xl:flex w-52 shrink-0 flex-col gap-0.5 p-4 border-r border-border-dark/70 overflow-y-auto custom-scrollbar">
                        {menuItems.map(item => {
                            const isActive = getIsActive(item.path);
                            return (
                                <Link
                                    key={item.path}
                                    href={item.path}
                                    className={`flex items-center gap-3 px-3 py-2.5 min-h-10 rounded-xl text-sm transition-all ${isActive
                                        ? 'bg-primary/10 text-primary border border-primary/20 shadow-sm font-bold'
                                        : 'text-text-secondary hover:text-main hover:bg-surface-highlight border border-transparent'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                                    {item.label}
                                </Link>
                            );
                        })}
                    </nav>

                    {/* ── Content area — only this scrolls ── */}
                    <div className="min-h-0 w-full min-w-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto custom-scrollbar">
                        <div className="box-border w-full min-w-0 max-w-full p-5 sm:p-6 xl:p-8">
                            {children}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
