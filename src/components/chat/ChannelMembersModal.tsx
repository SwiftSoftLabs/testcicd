'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { User } from '@/types';

interface ChannelMember {
    user_id: string;
    role: string;
    full_name: string | null;
    avatar_url: string | null;
    email: string | null;
    joined_at: string;
}

interface ChannelMembersModalProps {
    conversationId: string;
    channelName: string;
    workspaceUsers: User[];
    currentUserId: string;
    canManage: boolean;
    readOnly?: boolean;
    onClose: () => void;
}

export function ChannelMembersModal({
    conversationId,
    channelName,
    workspaceUsers,
    currentUserId,
    canManage,
    readOnly = false,
    onClose,
}: ChannelMembersModalProps) {
    const [channelMemberIds, setChannelMemberIds] = useState<Map<string, string>>(new Map()); // userId → role
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);

    const loadMembers = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.chat.getConversationMembers(conversationId);
            const map = new Map<string, string>();
            for (const m of res.data ?? []) map.set(m.user_id, m.role);
            setChannelMemberIds(map);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load members');
        } finally {
            setIsLoading(false);
        }
    }, [conversationId]);

    useEffect(() => {
        loadMembers();
    }, [loadMembers]);

    const filteredUsers = workspaceUsers.filter(u => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return u.name.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q);
    });

    const inChannel = filteredUsers.filter(u => channelMemberIds.has(u.id));
    const notInChannel = filteredUsers.filter(u => !channelMemberIds.has(u.id));

    const handleAdd = async (userId: string) => {
        if (readOnly) return;
        setBusyIds(prev => new Set(prev).add(userId));
        setError(null);
        try {
            await api.chat.addConversationMember(conversationId, userId);
            setChannelMemberIds(prev => new Map(prev).set(userId, 'member'));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to add member');
        } finally {
            setBusyIds(prev => { const s = new Set(prev); s.delete(userId); return s; });
        }
    };

    const handleRemove = async (userId: string) => {
        if (readOnly) return;
        setBusyIds(prev => new Set(prev).add(userId));
        setError(null);
        try {
            await api.chat.removeConversationMember(conversationId, userId);
            setChannelMemberIds(prev => { const m = new Map(prev); m.delete(userId); return m; });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to remove member');
        } finally {
            setBusyIds(prev => { const s = new Set(prev); s.delete(userId); return s; });
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm dismiss-backdrop" onClick={onClose}>
            <div
                className="cursor-pointer bg-surface-dark border border-border-dark rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-dark shrink-0">
                    <div>
                        <h3 className="font-bold text-white text-sm">Manage Members</h3>
                        <p className="text-text-secondary text-xs mt-0.5">
                            #{channelName} · {channelMemberIds.size} member{channelMemberIds.size !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="cursor-pointer p-1.5 rounded-lg text-text-secondary hover:text-white hover:bg-white/10 transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                {/* Search */}
                <div className="px-5 py-3 border-b border-border-dark shrink-0">
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-text-secondary">search</span>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search workspace members..."
                            autoFocus
                            className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm pl-9 pr-4 py-2 focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                        />
                    </div>
                </div>

                {error && (
                    <div className="mx-5 mt-3 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs shrink-0">
                        {error}
                    </div>
                )}
                {readOnly && (
                    <div className="mx-5 mt-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-200 text-xs shrink-0">
                        This channel is read-only because your workspace is over its plan limit. Upgrade to manage members.
                    </div>
                )}

                <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-3 space-y-4">
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <div className="size-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        </div>
                    ) : (
                        <>
                            {/* In channel */}
                            {inChannel.length > 0 && (
                                <div>
                                    <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">
                                        In channel ({inChannel.length})
                                    </p>
                                    <div className="space-y-1">
                                        {inChannel.map(user => {
                                            const role = channelMemberIds.get(user.id);
                                            const isAdmin = role === 'admin';
                                            const isSelf = user.id === currentUserId;
                                            const isBusy = busyIds.has(user.id);
                                            const canRemove = canManage && !isSelf && !isAdmin;
                                            return (
                                                <div key={user.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={user.avatar} className="size-7 rounded-full bg-slate-700 object-cover shrink-0" alt="" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <span className="text-sm text-white truncate">{user.name}</span>
                                                            {isSelf && <span className="text-[10px] text-text-secondary">(you)</span>}
                                                            {isAdmin && (
                                                                <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-medium">admin</span>
                                                            )}
                                                        </div>
                                                        {user.email && <p className="text-xs text-text-secondary truncate">{user.email}</p>}
                                                    </div>
                                                    <div className="shrink-0">
                                                        {canRemove ? (
                                                            <button
                                                                onClick={() => { if (!readOnly) void handleRemove(user.id); }}
                                                                disabled={readOnly || isBusy}
                                                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-red-400 bg-red-400/10 hover:bg-red-400/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-400/10"
                                                            >
                                                                {isBusy
                                                                    ? <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                                                                    : <span className="material-symbols-outlined text-[12px]">person_remove</span>
                                                                }
                                                                Remove
                                                            </button>
                                                        ) : (
                                                            <span className="text-[10px] text-text-secondary px-2">Member</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Not in channel */}
                            {notInChannel.length > 0 && (
                                <div>
                                    <p className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">
                                        Not in channel ({notInChannel.length})
                                    </p>
                                    <div className="space-y-1">
                                        {notInChannel.map(user => {
                                            const isBusy = busyIds.has(user.id);
                                            return (
                                                <div key={user.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={user.avatar} className="size-7 rounded-full bg-slate-700 object-cover shrink-0 opacity-50" alt="" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-text-secondary truncate">{user.name}</p>
                                                        {user.email && <p className="text-xs text-text-secondary/60 truncate">{user.email}</p>}
                                                    </div>
                                                    {canManage && (
                                                        <button
                                                            onClick={() => { if (!readOnly) void handleAdd(user.id); }}
                                                            disabled={readOnly || isBusy}
                                                            className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary/10"
                                                        >
                                                            {isBusy
                                                                ? <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                                                                : <span className="material-symbols-outlined text-[12px]">person_add</span>
                                                            }
                                                            Add
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {filteredUsers.length === 0 && (
                                <p className="text-text-secondary text-sm text-center py-6 opacity-50">No members found</p>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
