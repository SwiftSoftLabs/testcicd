import type { Conversation } from '@/types/chat';

function pickPreferredDm(
    a: Conversation,
    b: Conversation,
    preferConversationId?: string | null,
): Conversation {
    if (preferConversationId) {
        if (a.id === preferConversationId) return a;
        if (b.id === preferConversationId) return b;
    }
    const unreadA = a.unreadCount ?? 0;
    const unreadB = b.unreadCount ?? 0;
    if (unreadB > unreadA) return b;
    if (unreadA > unreadB) return a;
    return a;
}

/** Collapse duplicate DM rows (same dmOtherId) to a single sidebar entry. */
export function dedupeDmConversations(
    dms: Conversation[],
    options?: { preferConversationId?: string | null },
): Conversation[] {
    const byOther = new Map<string, Conversation>();
    for (const dm of dms) {
        const key = dm.dmOtherId ?? dm.id;
        const existing = byOther.get(key);
        if (!existing) {
            byOther.set(key, dm);
            continue;
        }
        byOther.set(key, pickPreferredDm(existing, dm, options?.preferConversationId));
    }
    return Array.from(byOther.values());
}

export function dedupeConversations(
    conversations: Conversation[],
    options?: { preferConversationId?: string | null },
): Conversation[] {
    const channels = conversations.filter((c) => c.type === 'channel');
    const dms = dedupeDmConversations(
        conversations.filter((c) => c.type === 'dm'),
        options,
    );
    return [...channels, ...dms];
}

type ApiConversationRow = {
    type: string;
    id: string;
    dm_other_id?: string | null;
    unread_count?: number | string | null;
};

/** Dedupe raw GET /api/chat/conversations rows before sending to any client. */
export function dedupeConversationApiRows<T extends ApiConversationRow>(rows: T[]): T[] {
    const channels = rows.filter((r) => r.type !== 'dm');
    const byOther = new Map<string, T>();

    for (const row of rows.filter((r) => r.type === 'dm')) {
        const key = row.dm_other_id ?? row.id;
        const existing = byOther.get(key);
        if (!existing) {
            byOther.set(key, row);
            continue;
        }
        const unreadA = Number(existing.unread_count ?? 0);
        const unreadB = Number(row.unread_count ?? 0);
        if (unreadB > unreadA) {
            byOther.set(key, row);
        }
    }

    return [...channels, ...Array.from(byOther.values())];
}
