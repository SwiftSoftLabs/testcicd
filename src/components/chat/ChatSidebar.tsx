'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { User } from '@/types';
import { PluginIcon } from '@/components/plugins/PluginIcon';
import PresenceDot from '@/components/PresenceDot';
import { presenceFromMemberStatus } from '@/lib/presence';
import type { ChatPluginProviderId } from '@/lib/api';
import { chatPluginIconId } from '@/lib/plugins/plugin-icons';
import { dedupeDmConversations } from '@/lib/chat/dedupeDms';
import type { Conversation as ChatConversation } from '@/types/chat';

interface Conversation {
    id: string;
    name: string;
    type: 'channel' | 'dm' | 'public' | 'private';
    unreadCount?: number;
    quota_locked?: boolean;
    dmOtherId?: string;
    dmOtherName?: string;
    dmOtherAvatar?: string;
}

export type ChannelPluginLink = {
    provider: ChatPluginProviderId;
    externalChannelName?: string | null;
};

interface ChatSidebarProps {
    channels: Conversation[];
    dms: Conversation[];
    users: User[];
    channelPluginLinks?: Record<string, ChannelPluginLink>;
    currentUserId?: string;
    activeChannelId: string;
    onSelectConversation: (id: string) => void;
    onSelectUser: (userId: string) => void;
    creatingDmUserId?: string | null;
    onCreateChannel: () => void;
    canCreateChannel?: boolean;
    className?: string;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
    channels,
    dms,
    users,
    channelPluginLinks = {},
    currentUserId,
    activeChannelId,
    onSelectConversation,
    onSelectUser,
    creatingDmUserId = null,
    onCreateChannel,
    canCreateChannel = true,
    className,
}) => {
    const [query, setQuery] = useState('');
    const [channelsOpen, setChannelsOpen] = useState(true);
    const [dmsOpen, setDmsOpen] = useState(true);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    const q = query.trim().toLowerCase();

    const filteredChannels = useMemo(
        () => (q ? channels.filter((c) => c.name.toLowerCase().includes(q)) : channels),
        [channels, q],
    );

    const uniqueDms = useMemo(
        () =>
            dedupeDmConversations(
                dms.filter((c) => c.type === 'dm') as ChatConversation[],
                { preferConversationId: activeChannelId || null },
            ),
        [dms, activeChannelId],
    );

    const dmUserIds = new Set(uniqueDms.map((c) => c.dmOtherId).filter(Boolean) as string[]);
    const usersWithoutDm = users.filter((u) => !dmUserIds.has(u.id) && u.id !== currentUserId);

    const filteredDms = useMemo(() => {
        if (!q) return uniqueDms;
        return uniqueDms.filter((dm) => {
            const name = (dm.dmOtherName || dm.name).toLowerCase();
            return name.includes(q);
        });
    }, [uniqueDms, q]);

    const filteredUsersWithoutDm = useMemo(() => {
        if (!q) return usersWithoutDm;
        return usersWithoutDm.filter((u) => u.name.toLowerCase().includes(q));
    }, [usersWithoutDm, q]);

    return (
        <aside className={`flex h-full shrink-0 flex-col border-r border-border-dark bg-surface-dark ${className ?? 'w-[280px]'}`}>
            <div className="border-b border-border-dark px-4 py-4">
                <div className="mb-3 flex items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15">
                        <span className="material-symbols-outlined text-[18px] text-primary">forum</span>
                    </div>
                    <h2 className="text-sm font-bold tracking-tight text-white">Chat</h2>
                </div>
                {isMobile && (
                    <p className="mb-3 text-xs text-text-secondary">Tap a channel to open</p>
                )}
                <div className="relative">
                    <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-text-secondary">
                        search
                    </span>
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={isMobile ? 'Search' : 'Search channels & people'}
                        className="w-full rounded-lg border border-border-dark bg-background-dark py-2 pl-9 pr-3 text-sm text-white placeholder:text-text-secondary/70 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                        aria-label="Search conversations"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {/* Channels */}
                <section className="px-2 py-2">
                    <div className="mb-1 flex w-full items-center gap-0.5">
                        <button
                            type="button"
                            onClick={() => setChannelsOpen((o) => !o)}
                            className="cursor-pointer flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-text-secondary hover:bg-white/5 hover:text-white"
                        >
                            <span>Channels</span>
                            <span
                                className={`material-symbols-outlined text-[16px] transition-transform ${channelsOpen ? '' : '-rotate-90'}`}
                            >
                                expand_more
                            </span>
                        </button>
                        {canCreateChannel && (
                            <button
                                type="button"
                                onClick={onCreateChannel}
                                className="cursor-pointer shrink-0 rounded-md p-1.5 text-text-secondary hover:bg-white/10 hover:text-white"
                                title="Create channel"
                                aria-label="Create channel"
                            >
                                <span className="material-symbols-outlined text-[16px]">add</span>
                            </button>
                        )}
                    </div>
                    {channelsOpen && (
                        <ul className="space-y-0.5">
                            {filteredChannels.length === 0 && (
                                <li className="px-3 py-2 text-xs text-text-secondary/60">
                                    {q ? 'No channels match' : 'No channels yet'}
                                </li>
                            )}
                            {filteredChannels.map((channel) => {
                                const active = activeChannelId === channel.id;
                                const link = channelPluginLinks[channel.id];
                                const linkTitle = link
                                    ? `Linked to ${link.externalChannelName ?? 'external channel'} on ${link.provider}`
                                    : undefined;
                                return (
                                    <li key={channel.id}>
                                        <button
                                            type="button"
                                            onClick={() => onSelectConversation(channel.id)}
                                            title={linkTitle}
                                            className={`cursor-pointer flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-all ${
                                                active
                                                    ? 'bg-primary/12 font-semibold text-primary shadow-[inset_2px_0_0_0_var(--color-primary)]'
                                                    : 'text-text-secondary hover:bg-white/5 hover:text-white'
                                            }`}
                                        >
                                            <span className="material-symbols-outlined text-[18px] opacity-70 shrink-0">tag</span>
                                            <span className="min-w-0 flex-1 truncate text-left">{channel.name}</span>
                                            {channel.quota_locked && (
                                                <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300 shrink-0">
                                                    Read-only
                                                </span>
                                            )}
                                            {link && (
                                                <PluginIcon
                                                    id={chatPluginIconId(link.provider)}
                                                    size={16}
                                                    className="ml-auto shrink-0 opacity-90"
                                                    title={linkTitle}
                                                />
                                            )}
                                            {!!channel.unreadCount && channel.unreadCount > 0 && (
                                                <span className="min-w-[18px] shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
                                                    {channel.unreadCount}
                                                </span>
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                {/* DMs */}
                <section className="border-t border-border-dark/60 px-2 py-2">
                    <button
                        type="button"
                        onClick={() => setDmsOpen((o) => !o)}
                        className="cursor-pointer mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-text-secondary hover:bg-white/5 hover:text-white"
                    >
                        <span>Direct messages</span>
                        <span
                            className={`material-symbols-outlined text-[16px] transition-transform ${dmsOpen ? '' : '-rotate-90'}`}
                        >
                            expand_more
                        </span>
                    </button>
                    {dmsOpen && (
                        <ul className="space-y-0.5">
                            {filteredDms.map((dm) => {
                                const name = dm.dmOtherName || dm.name;
                                const avatar =
                                    dm.dmOtherAvatar ||
                                    `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1e293b&color=e2e8f0`;
                                const otherUser = users.find((user) => user.id === dm.dmOtherId);
                                const active = activeChannelId === dm.id;
                                return (
                                    <li key={dm.id}>
                                        <button
                                            type="button"
                                            onClick={() => onSelectConversation(dm.id)}
                                            className={`cursor-pointer flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all ${
                                                active
                                                    ? 'bg-primary/12 font-semibold text-primary shadow-[inset_2px_0_0_0_var(--color-primary)]'
                                                    : 'text-text-secondary hover:bg-white/5 hover:text-white'
                                            }`}
                                        >
                                            <div className="relative shrink-0">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={avatar}
                                                    className="size-7 rounded-lg object-cover ring-1 ring-border-dark"
                                                    alt=""
                                                />
                                                <div className="absolute -bottom-0.5 -right-0.5">
                                                    <PresenceDot
                                                        status={presenceFromMemberStatus(otherUser?.status ?? 'Offline')}
                                                        ring
                                                    />
                                                </div>
                                            </div>
                                            <span className="truncate">{name}</span>
                                            {!!dm.unreadCount && dm.unreadCount > 0 && (
                                                <span className="ml-auto min-w-[18px] rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
                                                    {dm.unreadCount}
                                                </span>
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                            {filteredUsersWithoutDm.map((user) => {
                                const isCreating = creatingDmUserId === user.id;
                                const dmBusy = creatingDmUserId !== null;
                                return (
                                <li key={user.id}>
                                    <button
                                        type="button"
                                        disabled={dmBusy}
                                        onClick={() => onSelectUser(user.id)}
                                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-secondary transition-colors ${
                                            dmBusy
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'cursor-pointer hover:bg-white/5 hover:text-white'
                                        }`}
                                    >
                                        <div className="relative shrink-0">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={user.avatar}
                                                className="size-7 rounded-lg object-cover opacity-80 ring-1 ring-border-dark"
                                                alt=""
                                            />
                                            <div className="absolute -bottom-0.5 -right-0.5">
                                                <PresenceDot
                                                    status={presenceFromMemberStatus(user.status)}
                                                    ring
                                                />
                                            </div>
                                        </div>
                                        <span className="truncate">{user.name}</span>
                                        {isCreating && (
                                            <span className="material-symbols-outlined ml-auto animate-spin text-[16px] opacity-70">
                                                progress_activity
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                            })}
                            {filteredDms.length === 0 && filteredUsersWithoutDm.length === 0 && (
                                <li className="px-3 py-2 text-xs text-text-secondary/60">
                                    {q ? 'No people match' : 'No direct messages yet'}
                                </li>
                            )}
                        </ul>
                    )}
                </section>
            </div>
        </aside>
    );
};
