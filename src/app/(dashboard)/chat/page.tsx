'use client';

import React, { Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { callRoomHref } from '@/lib/calls/joinSession';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { insforgeNative } from '@/lib/insforge/native';
import { useAppContext } from '@/context/AppContext';
import { useAssistantPageContextBridge } from '@/context/AssistantPageContextBridge';
import { useUIContext } from '@/context/UIContext';
import { api } from '@/lib/api';
import { parseQuickCreate } from '@/lib/tasks/parseQuickCreate';
import type { BillingSummary } from '@/types/billing';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';
import type { ChannelPluginLink } from '@/components/chat/ChatSidebar';
import type { ChatPluginProviderId } from '@/lib/api';
import type { ChatMessage } from '@/components/chat/chat-types';
import {
    filterChannelTimelineMessages,
    isChannelTimelineMessage,
    mapApiMessage,
    toggleReactionInMetadata,
    type ChatMessageMetadata,
} from '@/components/chat/chat-types';
import { publishChatMessageUpdate } from '@/lib/chat/realtime-publish';
import type { ChatAttachment } from '@/components/chat/ChatInput';
import type { Conversation } from '@/types/chat';
import { conversationCache, messageCache, lastChannelStorage, resolveInitialConversationId } from '@/lib/chat/channelCache';
import { dedupeConversations, dedupeDmConversations } from '@/lib/chat/dedupeDms';
import { cn } from '@/lib/utils';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

const CHAT_MOBILE_BREAKPOINT = 768;

function ChatPageContent() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const convParam = searchParams.get('conv');
    const { currentUser, users, selectedWorkspaceId, selectedProjectId } = useAppContext();
    const { openModal, addToast } = useUIContext();
    const { setConversationId } = useAssistantPageContextBridge();
    const { can } = useWorkspacePermissions();
    const canCreateChannels = can('create_channels');
    const canCreateTasksFromChat = can('manage_workflows');
    const [liveCallId, setLiveCallId] = useState<string | null>(null);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConvId, setActiveConvId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [activeThreadRootId, setActiveThreadRootId] = useState<string | null>(null);
    const [threadReplies, setThreadReplies] = useState<ChatMessage[]>([]);
    const [threadParentMessage, setThreadParentMessage] = useState<ChatMessage | null>(null);
    const activeThreadRootIdRef = useRef<string | null>(null);
    const messagesRef = useRef<ChatMessage[]>([]);
    const threadRepliesRef = useRef<ChatMessage[]>([]);
    const threadParentMessageRef = useRef<ChatMessage | null>(null);
    /** Maps client_message_id → thread root while a thread send is in flight. */
    const pendingThreadSendsRef = useRef<Map<string, { rootId: string; alsoSendToChannel: boolean }>>(
        new Map(),
    );
    const sendingThreadRootRef = useRef<string | null>(null);
    const currentUserIdRef = useRef<string | undefined>(undefined);
    const threadCacheRef = useRef<Map<string, ChatMessage[]>>(new Map());
    const threadOnlyMessageIdsRef = useRef<Set<string>>(new Set());
    const [isLoadingMessages, setIsLoadingMessages] = useState(false);
    const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
    const [olderCursor, setOlderCursor] = useState<string | null>(null);
    const [hasOlderMessages, setHasOlderMessages] = useState(false);
    const [isLoadingConvs, setIsLoadingConvs] = useState(true);
    const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'reconnecting' | 'offline'>('offline');
    const [createTaskBusy, setCreateTaskBusy] = useState(false);
    const [isMobile, setIsMobile] = useState(
        () => typeof window !== 'undefined' && window.innerWidth < CHAT_MOBILE_BREAKPOINT,
    );
    const [mobilePanel, setMobilePanel] = useState<'list' | 'chat'>('list');
    const isMobileRef = useRef(false);

    // Create channel state
    const [showCreateChannel, setShowCreateChannel] = useState(false);
    const [newChannelName, setNewChannelName] = useState('');
    const [isCreatingChannel, setIsCreatingChannel] = useState(false);
    const [creatingDmUserId, setCreatingDmUserId] = useState<string | null>(null);
    const creatingDmRef = useRef<string | null>(null);
    const [channelPluginLinks, setChannelPluginLinks] = useState<Record<string, ChannelPluginLink>>({});

    const activeConvIdRef = useRef<string | null>(null);
    const selectedWorkspaceIdRef = useRef<string | null>(null);
    const olderCursorRef = useRef<string | null>(null);
    const hasOlderMessagesRef = useRef(false);
    type RealtimePayload = Record<string, unknown>;
    // Store realtime handler reference for proper cleanup
    const realtimeHandlerRef = useRef<((payload: RealtimePayload) => void) | null>(null);
    const realtimeUpdateHandlerRef = useRef<((payload: RealtimePayload) => void) | null>(null);

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        threadRepliesRef.current = threadReplies;
    }, [threadReplies]);

    useEffect(() => {
        threadParentMessageRef.current = threadParentMessage;
    }, [threadParentMessage]);

    useEffect(() => {
        currentUserIdRef.current = currentUser?.id;
    }, [currentUser?.id]);

    useEffect(() => { olderCursorRef.current = olderCursor; }, [olderCursor]);
    useEffect(() => { hasOlderMessagesRef.current = hasOlderMessages; }, [hasOlderMessages]);

    useEffect(() => {
        const syncMobile = () => {
            const mobile = window.innerWidth < CHAT_MOBILE_BREAKPOINT;
            setIsMobile(mobile);
            isMobileRef.current = mobile;
        };
        syncMobile();
        window.addEventListener('resize', syncMobile);
        return () => window.removeEventListener('resize', syncMobile);
    }, []);

    useEffect(() => {
        selectedWorkspaceIdRef.current = selectedWorkspaceId;
        setConversations([]);
        setActiveConvId(null);
        activeConvIdRef.current = null;
        setMessages([]);
        setActiveThreadRootId(null);
        activeThreadRootIdRef.current = null;
        setThreadReplies([]);
        setThreadParentMessage(null);
        setChannelPluginLinks({});
        setShowCreateChannel(false);
        setNewChannelName('');
        setIsLoadingConvs(!!selectedWorkspaceId);
    }, [selectedWorkspaceId]);

    useEffect(() => {
        setConversationId(activeConvId);
        return () => setConversationId(null);
    }, [activeConvId, setConversationId]);

    // ─── Fetch conversations ────────────────────────────────────────────────────
    const fetchConversations = useCallback(async () => {
        if (!selectedWorkspaceId || !currentUser?.id) {
            setIsLoadingConvs(false);
            return;
        }
        const workspaceId = selectedWorkspaceId;

        const buildResults = (
            result: { data?: Record<string, unknown>[] },
            linksRes: { links?: { conversationId: string; provider: string; externalChannelName?: string | null }[] },
        ) => {
            const linkMap: Record<string, ChannelPluginLink> = {};
            for (const link of linksRes.links ?? []) {
                linkMap[link.conversationId] = {
                    provider: link.provider as ChatPluginProviderId,
                    externalChannelName: link.externalChannelName,
                };
            }
            const convs = dedupeConversations(
                (result?.data || []).map((c) => ({
                    id: c.id as string,
                    name: (c.name as string) || 'unnamed',
                    type: c.type === 'dm' ? 'dm' as const : 'channel' as const,
                    unreadCount: Number(c.unread_count ?? 0),
                    quota_locked: Boolean(c.quota_locked),
                    description: c.description as string | undefined,
                    dmOtherId: (c.dm_other_id as string) || undefined,
                    dmOtherName: (c.dm_other_name as string) || undefined,
                    dmOtherAvatar: (c.dm_other_avatar as string) || undefined,
                })),
                { preferConversationId: activeConvIdRef.current },
            );
            return { convs, linkMap };
        };

        // Serve from cache immediately to skip the loading spinner
        const cached = conversationCache.get(workspaceId);
        if (cached) {
            setConversations(cached.conversations);
            setChannelPluginLinks(cached.pluginLinks);
            if (!activeConvIdRef.current && cached.conversations.length > 0) {
                const initialId = resolveInitialConversationId(cached.conversations, workspaceId);
                if (initialId) {
                    setActiveConvId(initialId);
                    activeConvIdRef.current = initialId;
                    if (isMobileRef.current) setMobilePanel('chat');
                }
            }
            setIsLoadingConvs(false);
            // Silently refresh in background
            void (async () => {
                try {
                    const [result, linksRes] = await Promise.all([
                        api.chat.getConversations(workspaceId) as Promise<{ data?: Record<string, unknown>[] }>,
                        api.chatPlugins.listLinks(workspaceId).catch(() => ({ links: [] })),
                    ]);
                    if (workspaceId !== selectedWorkspaceIdRef.current) return;
                    const { convs, linkMap } = buildResults(result, linksRes);
                    conversationCache.set(workspaceId, convs, linkMap);
                    setConversations(convs);
                    setChannelPluginLinks(linkMap);
                } catch {
                    // Cache is still valid — non-critical
                }
            })();
            return;
        }

        setIsLoadingConvs(true);
        try {
            const [result, linksRes] = await Promise.all([
                api.chat.getConversations(workspaceId) as Promise<{ data?: Record<string, unknown>[] }>,
                api.chatPlugins.listLinks(workspaceId).catch(() => ({ links: [] })),
            ]);
            if (workspaceId !== selectedWorkspaceIdRef.current) return;
            const { convs, linkMap } = buildResults(result, linksRes);
            conversationCache.set(workspaceId, convs, linkMap);
            setConversations(convs);
            setChannelPluginLinks(linkMap);
            if (convs.length > 0 && !activeConvIdRef.current) {
                const initialId = resolveInitialConversationId(convs, workspaceId);
                if (initialId) {
                    setActiveConvId(initialId);
                    activeConvIdRef.current = initialId;
                    if (isMobileRef.current) setMobilePanel('chat');
                }
            }
        } catch (err) {
            console.error('Error fetching conversations:', err);
        } finally {
            setIsLoadingConvs(false);
        }
    }, [selectedWorkspaceId, currentUser?.id]);

    useEffect(() => {
        fetchConversations();
    }, [fetchConversations]);

    // ─── Fetch messages ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (!activeConvId) return;
        const convId = activeConvId;
        let cancelled = false;

        setActiveThreadRootId(null);
        activeThreadRootIdRef.current = null;
        setThreadReplies([]);
        setThreadParentMessage(null);

        // Serve from cache immediately
        const cached = messageCache.get(convId);
        if (cached) {
            setMessages(cached.messages);
            setOlderCursor(cached.olderCursor);
            setHasOlderMessages(cached.hasOlderMessages);
            setIsLoadingMessages(false);
            return () => {
                cancelled = true;
                if (messagesRef.current.length > 0) {
                    messageCache.set(convId, messagesRef.current, olderCursorRef.current, hasOlderMessagesRef.current);
                }
            };
        }

        setIsLoadingMessages(true);
        setMessages([]);
        setOlderCursor(null);
        setHasOlderMessages(false);

        api.chat.getMessages(convId, undefined, 100)
            .then((result) => {
                if (cancelled || convId !== activeConvIdRef.current) return;
                const res = result as { data?: Record<string, unknown>[] };
                const msgs = filterChannelTimelineMessages(
                    (res?.data || []).map((m) => mapApiMessage(m as Record<string, unknown>)),
                );
                const hasMore = msgs.length >= 100;
                const cursor = msgs[0]?.id ?? null;
                setMessages(msgs);
                setHasOlderMessages(hasMore);
                setOlderCursor(cursor);
                messageCache.set(convId, msgs, cursor, hasMore);
            })
            .catch(err => {
                if (!cancelled && convId === activeConvIdRef.current) {
                    console.error('Error fetching messages:', err);
                }
            })
            .finally(() => {
                if (!cancelled && convId === activeConvIdRef.current) {
                    setIsLoadingMessages(false);
                }
            });

        return () => {
            cancelled = true;
            if (messagesRef.current.length > 0) {
                messageCache.set(convId, messagesRef.current, olderCursorRef.current, hasOlderMessagesRef.current);
            }
        };
    }, [activeConvId]);

    const loadOlderMessages = useCallback(async () => {
        if (!activeConvId || !olderCursor || loadingOlderMessages) return;
        const convId = activeConvId;
        setLoadingOlderMessages(true);
        const scrollEl = document.querySelector('[data-chat-scroll]') as HTMLElement | null;
        const prevHeight = scrollEl?.scrollHeight ?? 0;
        try {
            const result = await api.chat.getMessages(convId, olderCursor, 100);
            if (convId !== activeConvIdRef.current) return;
            const res = result as { data?: Record<string, unknown>[] };
            const older = filterChannelTimelineMessages(
                (res?.data || []).map((m) => mapApiMessage(m as Record<string, unknown>)),
            );
            if (older.length === 0) {
                setHasOlderMessages(false);
                return;
            }
            setMessages((prev) => {
                const ids = new Set(prev.map((m) => m.id));
                const merged = [...older.filter((m) => !ids.has(m.id)), ...prev];
                return merged;
            });
            if (older.length < 100) {
                setHasOlderMessages(false);
            } else {
                setOlderCursor(older[0]?.id ?? null);
            }
            requestAnimationFrame(() => {
                if (scrollEl) {
                    scrollEl.scrollTop = scrollEl.scrollHeight - prevHeight;
                }
            });
        } catch (err) {
            if (convId === activeConvIdRef.current) {
                console.error('Error loading older messages', err);
            }
        } finally {
            if (convId === activeConvIdRef.current) {
                setLoadingOlderMessages(false);
            }
        }
    }, [activeConvId, olderCursor, loadingOlderMessages]);

    // ─── InsForge Realtime ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!activeConvId) return;

        let subscribed = false;
        const channelName = `chat:${activeConvId}`;

        // Remove previous handlers before setting new ones
        if (realtimeHandlerRef.current) {
            insforgeNative.realtime.off('INSERT_message', realtimeHandlerRef.current);
        }
        if (realtimeUpdateHandlerRef.current) {
            insforgeNative.realtime.off('UPDATE_message', realtimeUpdateHandlerRef.current);
        }

        const messageHandler = (payload: RealtimePayload) => {
            if (payload.conversation_id !== activeConvIdRef.current) return;

            let threadRootId = (payload.thread_root_message_id as string) || undefined;
            const alsoSentToChannel = Boolean(payload.also_sent_to_channel);
            const clientId = payload.client_message_id as string | undefined;
            const pendingSend = clientId ? pendingThreadSendsRef.current.get(clientId) : undefined;
            if (!threadRootId && !alsoSentToChannel && payload.reply_to_message_id) {
                threadRootId = payload.reply_to_message_id as string;
            }
            if (!threadRootId && pendingSend && !alsoSentToChannel) {
                threadRootId = pendingSend.rootId;
            }
            if (
                !threadRootId &&
                !alsoSentToChannel &&
                sendingThreadRootRef.current &&
                payload.sender_id === currentUserIdRef.current
            ) {
                threadRootId = sendingThreadRootRef.current;
            }
            const created = payload.created_at as string;

            const incoming: ChatMessage = {
                id: payload.id as string,
                senderId: payload.sender_id as string,
                senderName: (payload.sender_name as string) || undefined,
                senderAvatar: (payload.sender_avatar as string) || undefined,
                content: payload.content as string,
                createdAt: created,
                timestamp: new Date(created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                status: payload.deleted_at ? 'deleted' : 'sent',
                clientMessageId: payload.client_message_id as string | undefined,
                metadata: payload.metadata as ChatMessage['metadata'],
                updatedAt: payload.updated_at as string | undefined,
                deletedAt: payload.deleted_at as string | undefined,
                threadRootMessageId: threadRootId,
                alsoSentToChannel,
            };

            if (threadRootId) {
                if (clientId) pendingThreadSendsRef.current.delete(clientId);
                if (incoming.id) threadOnlyMessageIdsRef.current.add(incoming.id);

                setMessages((prev) =>
                    prev.map((m) => {
                        if (m.id !== threadRootId) return m;
                        const replyCount =
                            typeof payload.thread_root_reply_count === 'number'
                                ? payload.thread_root_reply_count
                                : (m.replyCount ?? 0) + 1;
                        return {
                            ...m,
                            replyCount,
                            lastReplyAt: (payload.thread_root_last_reply_at as string) || created,
                        };
                    }),
                );

                if (activeThreadRootIdRef.current === threadRootId) {
                    setThreadReplies((prev) => {
                        const isDuplicate = prev.some(
                            (msg) =>
                                msg.id === incoming.id ||
                                (msg.clientMessageId &&
                                    msg.clientMessageId === incoming.clientMessageId),
                        );
                        if (isDuplicate) {
                            return prev.map((msg) =>
                                msg.clientMessageId &&
                                msg.clientMessageId === incoming.clientMessageId
                                    ? { ...msg, id: incoming.id, status: 'sent' as const }
                                    : msg,
                            );
                        }
                        return [...prev, incoming];
                    });
                } else if (
                    clientId &&
                    threadRepliesRef.current.some((msg) => msg.clientMessageId === clientId)
                ) {
                    setThreadReplies((prev) => {
                        const isDuplicate = prev.some(
                            (msg) =>
                                msg.id === incoming.id ||
                                (msg.clientMessageId && msg.clientMessageId === clientId),
                        );
                        if (isDuplicate) {
                            return prev.map((msg) =>
                                msg.clientMessageId === clientId
                                    ? { ...msg, id: incoming.id, status: 'sent' as const }
                                    : msg,
                            );
                        }
                        return [...prev, incoming];
                    });
                }

                if (!alsoSentToChannel) {
                    return;
                }
            }

            if (threadOnlyMessageIdsRef.current.has(incoming.id)) {
                return;
            }

            if (!isChannelTimelineMessage(incoming)) {
                return;
            }

            setMessages((prev) => {
                const isDuplicate = prev.some(
                    (msg) =>
                        msg.id === incoming.id ||
                        (msg.clientMessageId &&
                            msg.clientMessageId === incoming.clientMessageId),
                );
                if (isDuplicate) {
                    return prev.map((msg) =>
                        msg.clientMessageId && msg.clientMessageId === incoming.clientMessageId
                            ? { ...msg, id: incoming.id, status: 'sent' as const }
                            : msg,
                    );
                }
                return [...prev, incoming];
            });
        };

        const applyMessageUpdate = (payload: RealtimePayload) => {
            const patch = (msg: ChatMessage): ChatMessage =>
                msg.id === payload.id
                    ? {
                        ...msg,
                        content: payload.content as string,
                        status: payload.deleted_at ? 'deleted' : 'sent',
                        metadata: payload.metadata as ChatMessage['metadata'],
                        updatedAt: payload.updated_at as string | undefined,
                        deletedAt: payload.deleted_at as string | undefined,
                    }
                    : msg;

            setMessages((prev) => prev.map(patch));
            setThreadReplies((prev) => prev.map(patch));
            setThreadParentMessage((prev) => {
                if (prev && prev.id === payload.id) return patch(prev);
                return prev;
            });
        };

        const updateHandler = (payload: RealtimePayload) => {
            if (payload.conversation_id !== activeConvIdRef.current) return;
            applyMessageUpdate(payload);
        };

        realtimeHandlerRef.current = messageHandler;
        realtimeUpdateHandlerRef.current = updateHandler;

        const setupRealtime = async () => {
            try {
                setRealtimeStatus('reconnecting');
                if (!insforgeNative.realtime.isConnected) {
                    await insforgeNative.realtime.connect();
                }
                const result = await insforgeNative.realtime.subscribe(channelName);
                if (!result.ok) {
                    setRealtimeStatus('offline');
                    return;
                }
                subscribed = true;
                setRealtimeStatus('connected');
                insforgeNative.realtime.on('INSERT_message', messageHandler);
                insforgeNative.realtime.on('UPDATE_message', updateHandler);
                insforgeNative.realtime.on('disconnect', () => setRealtimeStatus('offline'));
                insforgeNative.realtime.on('connect', () => setRealtimeStatus('connected'));
            } catch (err) {
                console.error('Realtime error:', err);
                setRealtimeStatus('offline');
            }
        };

        setupRealtime();

        return () => {
            if (subscribed) insforgeNative.realtime.unsubscribe(channelName);
            if (realtimeHandlerRef.current) {
                insforgeNative.realtime.off('INSERT_message', realtimeHandlerRef.current);
                realtimeHandlerRef.current = null;
            }
            if (realtimeUpdateHandlerRef.current) {
                insforgeNative.realtime.off('UPDATE_message', realtimeUpdateHandlerRef.current);
                realtimeUpdateHandlerRef.current = null;
            }
            setRealtimeStatus('offline');
        };
    }, [activeConvId]);

    // ─── Subscribe to workspace-level channel for new channel notifications ────
    useEffect(() => {
        if (!selectedWorkspaceId || !currentUser?.id) return;

        const workspaceChannel = `workspace:${selectedWorkspaceId}`;
        let subscribed = false;

        const newConvHandler = (payload: RealtimePayload) => {
            if ((payload.created_by as string) === currentUser.id) return;
            const newConv: Conversation = {
                id: payload.id as string,
                name: payload.name as string,
                type: 'channel',
                unreadCount: 0,
                description: payload.description as string | undefined,
            };
            setConversations(prev => {
                if (prev.some(c => c.id === newConv.id)) return prev;
                return [...prev, newConv];
            });
        };

        const setup = async () => {
            if (!insforgeNative.realtime.isConnected) {
                await insforgeNative.realtime.connect();
            }
            const result = await insforgeNative.realtime.subscribe(workspaceChannel);
            if (result.ok) {
                subscribed = true;
                insforgeNative.realtime.on('INSERT_conversation', newConvHandler);
            }
        };
        setup();

        return () => {
            insforgeNative.realtime.off('INSERT_conversation', newConvHandler);
            if (subscribed) insforgeNative.realtime.unsubscribe(workspaceChannel);
        };
    }, [selectedWorkspaceId, currentUser?.id]);

    // Stable key from IDs only — changes when convs are added/removed, not when unread counts change
    const convIdsKey = useMemo(
        () => conversations.map(c => c.id).sort().join(','),
        [conversations]
    );

    // ─── Subscribe to all conversations for unread count tracking ──────────────
    useEffect(() => {
        if (!convIdsKey || !currentUser?.id) return;
        const ids = convIdsKey.split(',').filter(Boolean);
        const subscribed: string[] = [];

        const inactiveHandler = (payload: RealtimePayload) => {
            const convId = payload.conversation_id as string;
            if (convId === activeConvIdRef.current) return;
            if ((payload.sender_id as string) === currentUser.id) return;
            // Invalidate so the next switch to this channel fetches fresh messages
            messageCache.invalidate(convId);
            setConversations(prev =>
                prev.map(c => c.id === convId ? { ...c, unreadCount: (c.unreadCount ?? 0) + 1 } : c)
            );
            window.dispatchEvent(new CustomEvent('chatUnreadUpdated'));
        };

        const setup = async () => {
            for (const id of ids) {
                if (id === activeConvIdRef.current) continue;
                const result = await insforgeNative.realtime.subscribe(`chat:${id}`);
                if (result.ok) subscribed.push(id);
            }
            insforgeNative.realtime.on('INSERT_message', inactiveHandler);
        };
        setup();

        return () => {
            insforgeNative.realtime.off('INSERT_message', inactiveHandler);
            for (const id of subscribed) {
                if (id !== activeConvIdRef.current) insforgeNative.realtime.unsubscribe(`chat:${id}`);
            }
        };
    }, [convIdsKey, currentUser?.id]);

    // ─── Send message ───────────────────────────────────────────────────────────
    const handleSendMessage = useCallback(async (text: string, attachments?: ChatAttachment[]) => {
        if (!activeConvId || !currentUser?.id) return;

        const clientMessageId = `cid_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const nowIso = new Date().toISOString();
        const optimistic: ChatMessage = {
            id: clientMessageId,
            senderId: currentUser.id,
            senderName: currentUser.name,
            content: text,
            createdAt: nowIso,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: 'sending',
            clientMessageId,
            metadata: attachments && attachments.length > 0 ? { attachments } : undefined,
        };
        setMessages((prev) => [...prev, optimistic]);

        try {
            const result = await api.chat.sendMessage({
                conversation_id: activeConvId,
                content: text || ' ',
                type: 'text',
                client_message_id: clientMessageId,
                attachments: attachments && attachments.length > 0 ? attachments : undefined,
            }) as { data?: { id: string; created_at?: string } };

            const savedMsg = result?.data;

            if (insforgeNative.realtime.isConnected && savedMsg) {
                try {
                    await insforgeNative.realtime.publish(`chat:${activeConvId}`, 'INSERT_message', {
                        id: savedMsg.id,
                        conversation_id: activeConvId,
                        sender_id: currentUser.id,
                        sender_name: currentUser.name,
                        content: text,
                        created_at: savedMsg.created_at || new Date().toISOString(),
                        client_message_id: clientMessageId,
                    });
                } catch {
                    /* non-blocking */
                }
            } else {
                setMessages((prev) =>
                    prev.map((m) =>
                        m.clientMessageId === clientMessageId
                            ? { ...m, id: savedMsg?.id || m.id, status: 'sent' as const }
                            : m,
                    ),
                );
            }
        } catch (err) {
            console.error('Error sending message:', err);
            setMessages((prev) =>
                prev.map((m) =>
                    m.clientMessageId === clientMessageId ? { ...m, status: 'failed' as const } : m,
                ),
            );
        }
    }, [activeConvId, currentUser]);

    const handleSendThreadReply = useCallback(
        async (
            threadRootId: string,
            text: string,
            attachments?: ChatAttachment[],
            alsoSendToChannel = false,
        ) => {
            if (!activeConvId || !currentUser?.id) return;

            const clientMessageId = `cid_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const nowIso = new Date().toISOString();
            const optimistic: ChatMessage = {
                id: clientMessageId,
                senderId: currentUser.id,
                senderName: currentUser.name,
                content: text,
                createdAt: nowIso,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                status: 'sending',
                clientMessageId,
                threadRootMessageId: threadRootId,
                alsoSentToChannel: alsoSendToChannel,
                metadata: attachments && attachments.length > 0 ? { attachments } : undefined,
            };

            pendingThreadSendsRef.current.set(clientMessageId, {
                rootId: threadRootId,
                alsoSendToChannel,
            });
            if (!alsoSendToChannel) {
                sendingThreadRootRef.current = threadRootId;
            }

            setThreadReplies((prev) => {
                const next = [...prev, optimistic];
                threadCacheRef.current.set(threadRootId, next);
                return next;
            });
            setMessages((prev) =>
                prev.map((m) =>
                    m.id === threadRootId
                        ? {
                              ...m,
                              replyCount: (m.replyCount ?? 0) + 1,
                              lastReplyAt: nowIso,
                          }
                        : m,
                ),
            );
            if (alsoSendToChannel) {
                setMessages((prev) => [...prev, { ...optimistic }]);
            }

            try {
                const result = (await api.chat.sendMessage({
                    conversation_id: activeConvId,
                    content: text || ' ',
                    type: 'text',
                    client_message_id: clientMessageId,
                    thread_root_message_id: threadRootId,
                    also_send_to_channel: alsoSendToChannel,
                    attachments: attachments && attachments.length > 0 ? attachments : undefined,
                })) as {
                    data?: {
                        id: string;
                        created_at?: string;
                        thread_root_reply_count?: number;
                        thread_root_last_reply_at?: string;
                    };
                };

                const savedMsg = result?.data;

                if (insforgeNative.realtime.isConnected && savedMsg) {
                    try {
                        await insforgeNative.realtime.publish(`chat:${activeConvId}`, 'INSERT_message', {
                            id: savedMsg.id,
                            conversation_id: activeConvId,
                            sender_id: currentUser.id,
                            sender_name: currentUser.name,
                            content: text,
                            created_at: savedMsg.created_at || new Date().toISOString(),
                            client_message_id: clientMessageId,
                            thread_root_message_id: threadRootId,
                            also_sent_to_channel: alsoSendToChannel,
                            thread_root_reply_count: savedMsg.thread_root_reply_count ?? null,
                            thread_root_last_reply_at: savedMsg.thread_root_last_reply_at ?? null,
                        });
                    } catch {
                        /* non-blocking */
                    }
                } else {
                    setThreadReplies((prev) =>
                        prev.map((m) =>
                            m.clientMessageId === clientMessageId
                                ? { ...m, id: savedMsg?.id || m.id, status: 'sent' as const }
                                : m,
                        ),
                    );
                }
                if (!alsoSendToChannel) {
                    setMessages((prev) => filterChannelTimelineMessages(prev));
                }
                sendingThreadRootRef.current = null;
            } catch (err) {
                console.error('Error sending thread reply:', err);
                pendingThreadSendsRef.current.delete(clientMessageId);
                sendingThreadRootRef.current = null;
                setThreadReplies((prev) =>
                    prev.map((m) =>
                        m.clientMessageId === clientMessageId ? { ...m, status: 'failed' as const } : m,
                    ),
                );
            }
        },
        [activeConvId, currentUser],
    );

    const handleOpenThread = useCallback((rootId: string) => {
        setActiveThreadRootId(rootId);
        activeThreadRootIdRef.current = rootId;
        setThreadReplies(threadCacheRef.current.get(rootId) ?? []);
        setThreadParentMessage(messagesRef.current.find((m) => m.id === rootId) ?? null);
    }, []);

    const handleCloseThread = useCallback(() => {
        const rootId = activeThreadRootIdRef.current;
        if (rootId && threadRepliesRef.current.length > 0) {
            threadCacheRef.current.set(rootId, threadRepliesRef.current);
        }
        setActiveThreadRootId(null);
        activeThreadRootIdRef.current = null;
        setThreadReplies([]);
        setThreadParentMessage(null);
        setMessages((prev) => filterChannelTimelineMessages(prev));
    }, []);

    const handleThreadRepliesLoaded = useCallback(
        (
            rootId: string,
            parent: ChatMessage | null,
            replies: ChatMessage[],
            _hasMore: boolean,
            _nextCursor: string | null,
            append?: boolean,
        ) => {
            setThreadParentMessage(
                (prev) => parent ?? prev ?? messagesRef.current.find((m) => m.id === rootId) ?? null,
            );
            setThreadReplies((prev) => {
                const merged = append
                    ? (() => {
                        const ids = new Set(prev.map((r) => r.id));
                        return [...prev, ...replies.filter((r) => !ids.has(r.id))];
                    })()
                    : replies.length > 0
                      ? replies
                      : prev;
                threadCacheRef.current.set(rootId, merged);
                for (const r of merged) {
                    if (r.id) threadOnlyMessageIdsRef.current.add(r.id);
                }
                return merged;
            });
        },
        [],
    );

    const applyMessageMetadata = useCallback((messageId: string, metadata: ChatMessageMetadata | undefined) => {
        const patch = (msg: ChatMessage): ChatMessage =>
            msg.id === messageId ? { ...msg, metadata } : msg;

        setMessages((prev) => prev.map(patch));
        setThreadReplies((prev) => prev.map(patch));
        setThreadParentMessage((prev) => (prev?.id === messageId ? { ...prev, metadata } : prev));
    }, []);

    const applyMessageContent = useCallback((messageId: string, content: string, updatedAt: string | undefined) => {
        const patch = (msg: ChatMessage): ChatMessage =>
            msg.id === messageId ? { ...msg, content, updatedAt } : msg;

        setMessages((prev) => prev.map(patch));
        setThreadReplies((prev) => prev.map(patch));
        setThreadParentMessage((prev) => (prev?.id === messageId ? patch(prev) : prev));
    }, []);

    const findMessageById = useCallback((messageId: string): ChatMessage | undefined => {
        return (
            messagesRef.current.find((m) => m.id === messageId) ??
            threadRepliesRef.current.find((m) => m.id === messageId) ??
            (threadParentMessageRef.current?.id === messageId
                ? threadParentMessageRef.current
                : undefined)
        );
    }, []);

    // ─── Toggle reaction ──────────────────────────────────────────────────────
    const handleToggleReaction = useCallback(async (messageId: string, emoji: string) => {
        if (!currentUser?.id || !activeConvId) return;

        const message = findMessageById(messageId);
        const prevMetadata = message?.metadata;
        const optimisticMetadata = toggleReactionInMetadata(prevMetadata, emoji, currentUser.id);

        applyMessageMetadata(messageId, optimisticMetadata);

        try {
            const result = (await api.chat.toggleReaction(
                messageId,
                emoji,
                currentUser.id,
            )) as { data?: { metadata?: ChatMessageMetadata } };
            const serverMetadata = result?.data?.metadata ?? optimisticMetadata;
            applyMessageMetadata(messageId, serverMetadata);

            void publishChatMessageUpdate(activeConvId, {
                id: messageId,
                conversation_id: activeConvId,
                content: message?.content ?? '',
                metadata: serverMetadata,
                deleted_at: null,
                updated_at: new Date().toISOString(),
            });
        } catch (err) {
            console.error('Failed to toggle reaction', err);
            applyMessageMetadata(messageId, prevMetadata);
        }
    }, [activeConvId, applyMessageMetadata, currentUser?.id, findMessageById]);

    // ─── Delete message ─────────────────────────────────────────────────────────
    const handleDeleteMessage = useCallback(async (id: string) => {
        const deletedAt = new Date().toISOString();
        setMessages((prev) =>
            prev.map((m) =>
                m.id === id ? { ...m, status: 'deleted' as const, deletedAt } : m,
            ),
        );
        setThreadReplies((prev) =>
            prev.map((m) =>
                m.id === id ? { ...m, status: 'deleted' as const, deletedAt } : m,
            ),
        );
        if (insforgeNative.realtime.isConnected && activeConvId) {
            try {
                await insforgeNative.realtime.publish(`chat:${activeConvId}`, 'UPDATE_message', {
                    id,
                    conversation_id: activeConvId,
                    deleted_at: new Date().toISOString(),
                    content: '',
                    metadata: null,
                    updated_at: null,
                });
            } catch {
                // Non-blocking — local state already updated
            }
        }
    }, [activeConvId]);

    // ─── Edit message ───────────────────────────────────────────────────────────
    const handleEditMessage = useCallback(async (id: string, content: string) => {
        if (!activeConvId) return;

        const result = (await api.chat.editMessage(id, content)) as {
            data?: { content?: string; metadata?: ChatMessageMetadata; updated_at?: string };
        };
        const savedContent = result?.data?.content ?? content;
        const updatedAt = result?.data?.updated_at;

        applyMessageContent(id, savedContent, updatedAt);

        void publishChatMessageUpdate(activeConvId, {
            id,
            conversation_id: activeConvId,
            content: savedContent,
            metadata: result?.data?.metadata ?? null,
            deleted_at: null,
            updated_at: updatedAt,
        });
    }, [activeConvId, applyMessageContent]);

    // ─── Select conversation ────────────────────────────────────────────────────
    const handleSelectConversation = useCallback((id: string) => {
        const isNewSelection = id !== activeConvIdRef.current;
        if (isNewSelection) {
            setMessages([]);
            setIsLoadingMessages(true);
        }
        setActiveConvId(id);
        activeConvIdRef.current = id;
        if (selectedWorkspaceIdRef.current) {
            lastChannelStorage.set(selectedWorkspaceIdRef.current, id);
        }
        if (isNewSelection) {
            setConversations((prev) =>
                prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)),
            );
            if (isMobileRef.current) {
                setMobilePanel('chat');
            }
            if (currentUser?.id) {
                api.chat
                    .markRead(id, currentUser.id)
                    .then(() =>
                        window.dispatchEvent(new CustomEvent('chatUnreadUpdated')),
                    )
                    .catch(() => {});
            }
        }
    }, [currentUser?.id]);

    // ─── Auto-select conversation from ?conv= query param (notification deep-link) ─
    const convParamReady = useMemo(() => {
        if (!convParam) return false;
        return conversations.some((conversation) => conversation.id === convParam);
    }, [convParam, convIdsKey]);

    useEffect(() => {
        if (!convParam || !convParamReady) return;
        if (activeConvIdRef.current === convParam) return;
        handleSelectConversation(convParam);
    }, [convParam, convParamReady, handleSelectConversation]);

    // ─── Select user (open/create DM) ──────────────────────────────────────────
    const handleSelectUser = useCallback(async (userId: string) => {
        if (!selectedWorkspaceId || !currentUser?.id) return;

        const existingDm = conversations.find(
            (c) => c.type === 'dm' && c.dmOtherId === userId,
        );
        if (existingDm) {
            handleSelectConversation(existingDm.id);
            return;
        }

        if (creatingDmRef.current) return;

        const targetUser = users.find(u => u.id === userId);
        const dmName = targetUser?.name || 'Direct Message';

        creatingDmRef.current = userId;
        setCreatingDmUserId(userId);
        try {
            const result = await api.chat.createConversation({
                type: 'dm',
                workspace_id: selectedWorkspaceId,
                created_by: currentUser.id,
                member_ids: [currentUser.id, userId],
                name: dmName,
            }) as { data?: { id: string; name?: string } };

            const conv = result?.data;
            if (!conv) return;

            const newDm: Conversation = {
                id: conv.id,
                name: conv.name || dmName,
                type: 'dm',
                unreadCount: 0,
                dmOtherId: userId,
                dmOtherName: targetUser?.name,
                dmOtherAvatar: targetUser?.avatar,
            };

            setConversations((prev) =>
                dedupeConversations(
                    prev.some((c) => c.id === conv.id) ? prev : [...prev, newDm],
                    { preferConversationId: conv.id },
                ),
            );
            handleSelectConversation(conv.id);
        } catch (err) {
            console.error('Error creating DM:', err);
        } finally {
            creatingDmRef.current = null;
            setCreatingDmUserId(null);
        }
    }, [selectedWorkspaceId, currentUser?.id, users, conversations, handleSelectConversation]);

    // ─── Create channel ─────────────────────────────────────────────────────────
    const handleOpenCreateChannel = useCallback(async () => {
        if (!selectedWorkspaceId || !currentUser?.id) return;

        try {
            const billingRes = await authenticatedFetch(`/api/billing/summary?workspaceId=${selectedWorkspaceId}`);
            if (billingRes.ok) {
                const { data } = await billingRes.json() as { data: BillingSummary };
                const max = data?.entitlements?.max_channels ?? null;
                // Optimistic client-side gate using cached state — avoids a round-trip on most opens.
                // Concurrent creation across tabs can both pass; server's checkChannelLimit is authoritative.
                const channelCount = conversations.filter((c) => c.type === 'channel').length;
                if (max !== null && channelCount >= max) {
                    setShowCreateChannel(false);
                    setNewChannelName('');
                    openModal('plan-comparison', {
                        note: 'Upgrade to create more channels.',
                        canManage: data?.canManage ?? false,
                        currentPlan: data?.plan?.code ?? 'basic',
                        plans: data?.plans ?? [],
                        workspaceId: selectedWorkspaceId,
                    });
                    return;
                }
            }
        } catch {
            // Fail open — a billing fetch issue should not block channel creation.
        }

        setShowCreateChannel(true);
    }, [conversations, currentUser?.id, openModal, selectedWorkspaceId]);

    const handleCreateChannel = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newChannelName.trim() || !selectedWorkspaceId || !currentUser?.id) return;

        setIsCreatingChannel(true);
        try {
            const billingRes = await authenticatedFetch(`/api/billing/summary?workspaceId=${selectedWorkspaceId}`);
            if (billingRes.ok) {
                const { data } = await billingRes.json() as { data: BillingSummary };
                const max = data?.entitlements?.max_channels ?? null;
                const channelCount = conversations.filter((c) => c.type === 'channel').length;
                if (max !== null && channelCount >= max) {
                    setShowCreateChannel(false);
                    setNewChannelName('');
                    openModal('plan-comparison', { note: 'Upgrade to create more channels.', canManage: data?.canManage ?? false, currentPlan: data?.plan?.code ?? 'basic', plans: data?.plans ?? [], workspaceId: selectedWorkspaceId });
                    return;
                }
            }

            const result = await api.chat.createConversation({
                type: 'channel',
                name: newChannelName.trim().toLowerCase().replace(/\s+/g, '-'),
                workspace_id: selectedWorkspaceId,
                created_by: currentUser.id,
            }) as { data?: { id: string; name: string } };

            const conv = result?.data;
            if (!conv) return;

            const newConv: Conversation = {
                id: conv.id,
                name: conv.name,
                type: 'channel',
                unreadCount: 0,
            };

            setConversations(prev => [...prev, newConv]);
            handleSelectConversation(conv.id);
            setNewChannelName('');
            setShowCreateChannel(false);

            if (insforgeNative.realtime.isConnected) {
                try {
                    await insforgeNative.realtime.publish(
                        `workspace:${selectedWorkspaceId}`,
                        'INSERT_conversation',
                        { id: conv.id, name: conv.name, type: 'channel', description: '', created_by: currentUser.id },
                    );
                } catch {
                    // Non-blocking — DB membership already ensures visibility
                }
            }
        } catch (err) {
            console.error('Error creating channel:', err);
        } finally {
            setIsCreatingChannel(false);
        }
    }, [newChannelName, selectedWorkspaceId, currentUser?.id, conversations, openModal, handleSelectConversation]);

    const channels = conversations.filter(c => c.type === 'channel');
    const dms = dedupeDmConversations(
        conversations.filter((c) => c.type === 'dm'),
        { preferConversationId: activeConvId },
    );
    const activeConv = conversations.find(c => c.id === activeConvId);

    const handleCreateTaskFromMessage = useCallback(
        async (content: string, senderName: string) => {
            const convLabel =
                activeConv?.type === 'dm'
                    ? `DM with ${activeConv.dmOtherName || activeConv.name}`
                    : `#${activeConv?.name || 'channel'}`;
            const hint = `From chat ${convLabel}, ${senderName} wrote:\n${content.slice(0, 2_000)}`;
            setCreateTaskBusy(true);
            try {
                const data = await api.tasks.runAi({ kind: 'quick_create', hint });
                const draft = parseQuickCreate(data);
                if (!draft) {
                    addToast('Could not parse AI task draft.', 'error');
                    return;
                }
                openModal('new-task', {
                    initialProjectId: selectedProjectId ?? undefined,
                    initialTitle: draft.title,
                    initialDescription: draft.description,
                    initialPriority: draft.priority,
                    initialTags: draft.tags.join(', '),
                });
            } catch (e) {
                addToast(e instanceof Error ? e.message : 'AI request failed', 'error');
            } finally {
                setCreateTaskBusy(false);
            }
        },
        [activeConv, addToast, openModal, selectedProjectId],
    );

    // ─── Loading state ──────────────────────────────────────────────────────────
    if (isLoadingConvs) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-background-dark">
                <div className="text-center space-y-3">
                    <div className="size-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
                    <p className="text-text-secondary text-sm">Loading conversations...</p>
                </div>
            </div>
        );
    }

    // ─── Not logged in ──────────────────────────────────────────────────────────
    if (!currentUser?.id) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-background-dark">
                <div className="text-center space-y-3">
                    <span className="material-symbols-outlined text-text-secondary text-5xl">lock</span>
                    <p className="text-text-secondary text-sm">Please log in to use Chat.</p>
                </div>
            </div>
        );
    }

    // ─── No workspace ───────────────────────────────────────────────────────────
    if (!selectedWorkspaceId) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-background-dark">
                <div className="text-center space-y-3">
                    <span className="material-symbols-outlined text-text-secondary text-5xl">workspaces</span>
                    <p className="text-text-secondary text-sm">Create a workspace first to use Chat.</p>
                    <a href="/settings" className="inline-block mt-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition-all">
                        Go to Settings
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full overflow-hidden bg-background-dark relative">
            {/* Realtime status indicator */}
            {realtimeStatus !== 'connected' && conversations.length > 0 && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 bg-amber-500/20 border border-amber-500/30 rounded-full text-amber-400 text-xs font-medium flex items-center gap-2 pointer-events-none">
                    <div className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
                    {realtimeStatus === 'reconnecting' ? 'Connecting to realtime...' : 'Realtime offline — refresh to retry'}
                </div>
            )}

            {/* Create channel modal */}
            {showCreateChannel && canCreateChannels && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                        <div className="bg-surface-dark border border-border-dark rounded-2xl p-6 w-full max-w-sm shadow-2xl">
                            <h3 className="text-base font-bold text-white mb-4">Create Channel</h3>
                            <form onSubmit={handleCreateChannel} className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Channel Name</label>
                                    <div className="relative mt-1.5">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm font-bold">#</span>
                                        <input
                                            autoFocus
                                            type="text"
                                            value={newChannelName}
                                            onChange={e => setNewChannelName(e.target.value)}
                                            placeholder="e.g. design, backend"
                                            className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm pl-7 pr-4 py-2.5 focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        type="submit"
                                        disabled={isCreatingChannel || !newChannelName.trim()}
                                        className="cursor-pointer flex-1 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:bg-blue-600 disabled:opacity-50 transition-all"
                                    >
                                        {isCreatingChannel ? 'Creating...' : 'Create'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setShowCreateChannel(false); setNewChannelName(''); }}
                                        className="cursor-pointer flex-1 py-2.5 bg-white/5 text-text-secondary rounded-xl font-bold text-sm hover:bg-white/10 transition-all"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
            )}

            <div
                className={cn('shrink-0', isMobile && mobilePanel === 'chat' && 'hidden')}
            >
                <ChatSidebar
                    channels={channels}
                    dms={dms}
                    users={users}
                    channelPluginLinks={channelPluginLinks}
                    currentUserId={currentUser.id}
                    activeChannelId={activeConvId || ''}
                    onSelectConversation={handleSelectConversation}
                    onSelectUser={handleSelectUser}
                    creatingDmUserId={creatingDmUserId}
                    canCreateChannel={canCreateChannels}
                    onCreateChannel={() => void handleOpenCreateChannel()}
                    className={isMobile ? 'w-full' : 'w-[280px]'}
                />
            </div>

            <div
                className={cn(
                    'flex min-w-0 flex-1',
                    isMobile && mobilePanel === 'list' && 'hidden',
                )}
            >
            <ChatWindow
                liveCallId={liveCallId}
                onStartCall={async () => {
                    if (!selectedWorkspaceId || !activeConvId) return;
                    if (liveCallId) {
                        const from =
                            pathname +
                            (searchParams.toString()
                                ? `?${searchParams.toString()}`
                                : '');
                        router.push(callRoomHref(liveCallId, from));
                        return;
                    }
                    try {
                        const call = await api.calls.create({
                            workspace_id: selectedWorkspaceId,
                            conversation_id: activeConvId,
                            title: activeConv?.name ?? 'Chat call',
                            project_id: selectedProjectId ?? null,
                        });
                        setLiveCallId(call.id);
                        const from =
                            pathname +
                            (searchParams.toString()
                                ? `?${searchParams.toString()}`
                                : '');
                        router.push(callRoomHref(call.id, from));
                    } catch {
                        addToast('Could not start call', 'error');
                    }
                }}
                conversationId={activeConvId || ''}
                channelName={
                    activeConv?.type === 'dm'
                        ? (activeConv.dmOtherName || activeConv.name)
                        : (activeConv?.name || '')
                }
                channelType={activeConv?.type || 'channel'}
                dmPartnerId={activeConv?.dmOtherId}
                messages={messages}
                users={users}
                channels={channels}
                onSendMessage={handleSendMessage}
                onSendThreadReply={handleSendThreadReply}
                onDeleteMessage={handleDeleteMessage}
                onEditMessage={handleEditMessage}
                onToggleReaction={handleToggleReaction}
                onCreateTaskFromMessage={canCreateTasksFromChat ? handleCreateTaskFromMessage : undefined}
                createTaskBusy={createTaskBusy}
                isLoading={isLoadingMessages}
                loadingOlder={loadingOlderMessages}
                hasOlderMessages={hasOlderMessages}
                onLoadOlder={() => void loadOlderMessages()}
                currentUserId={currentUser?.id}
                workspaceId={selectedWorkspaceId ?? undefined}
                projectId={selectedProjectId ?? undefined}
                canManageMembers={canCreateChannels}
                activeThreadRootId={activeThreadRootId}
                onOpenThread={handleOpenThread}
                onCloseThread={handleCloseThread}
                threadReplies={threadReplies}
                threadParentMessage={threadParentMessage}
                onThreadRepliesLoaded={handleThreadRepliesLoaded}
                onBackToList={
                    isMobile ? () => setMobilePanel('list') : undefined
                }
                onSelectUser={handleSelectUser}
            />
            </div>
        </div>
    );
}

export default function ChatPage() {
    return (
        <Suspense>
            <ChatPageContent />
        </Suspense>
    );
}
