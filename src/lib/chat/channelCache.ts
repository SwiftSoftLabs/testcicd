import type { ChatMessage } from '@/components/chat/chat-types';
import type { ChannelPluginLink } from '@/components/chat/ChatSidebar';
import type { Conversation } from '@/types/chat';

const CONV_TTL_MS = 5 * 60 * 1000;
const MSG_TTL_MS = 90 * 1000;
const MAX_MSG_ENTRIES = 20;

type ConvEntry = {
    conversations: Conversation[];
    pluginLinks: Record<string, ChannelPluginLink>;
    fetchedAt: number;
};

type MsgEntry = {
    messages: ChatMessage[];
    olderCursor: string | null;
    hasOlderMessages: boolean;
    fetchedAt: number;
};

const convStore = new Map<string, ConvEntry>();
const msgStore = new Map<string, MsgEntry>();

export const conversationCache = {
    get(workspaceId: string): ConvEntry | null {
        const entry = convStore.get(workspaceId);
        if (!entry || Date.now() - entry.fetchedAt > CONV_TTL_MS) {
            if (entry) convStore.delete(workspaceId);
            return null;
        }
        return entry;
    },

    set(
        workspaceId: string,
        conversations: Conversation[],
        pluginLinks: Record<string, ChannelPluginLink>,
    ): void {
        convStore.set(workspaceId, { conversations, pluginLinks, fetchedAt: Date.now() });
    },
};

export const messageCache = {
    get(convId: string): MsgEntry | null {
        const entry = msgStore.get(convId);
        if (!entry || Date.now() - entry.fetchedAt > MSG_TTL_MS) {
            if (entry) msgStore.delete(convId);
            return null;
        }
        return entry;
    },

    set(
        convId: string,
        messages: ChatMessage[],
        olderCursor: string | null,
        hasOlderMessages: boolean,
    ): void {
        if (msgStore.size >= MAX_MSG_ENTRIES && !msgStore.has(convId)) {
            const oldest = [...msgStore.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
            if (oldest) msgStore.delete(oldest[0]);
        }
        msgStore.set(convId, { messages, olderCursor, hasOlderMessages, fetchedAt: Date.now() });
    },

    invalidate(convId: string): void {
        msgStore.delete(convId);
    },
};

const LAST_CONV_KEY = (workspaceId: string) => `chat:lastConv:${workspaceId}`;

export const lastChannelStorage = {
    get(workspaceId: string): string | null {
        if (typeof sessionStorage === 'undefined') return null;
        try {
            return sessionStorage.getItem(LAST_CONV_KEY(workspaceId));
        } catch {
            return null;
        }
    },

    set(workspaceId: string, convId: string): void {
        if (typeof sessionStorage === 'undefined') return;
        try {
            sessionStorage.setItem(LAST_CONV_KEY(workspaceId), convId);
        } catch {
            /* quota / private mode */
        }
    },
};

/** Pick initial conversation: last visited if still valid, else first in list. */
export function resolveInitialConversationId(
    convs: Conversation[],
    workspaceId: string,
): string | null {
    if (convs.length === 0) return null;
    const last = lastChannelStorage.get(workspaceId);
    if (last && convs.some((c) => c.id === last)) return last;
    return convs[0].id;
}
