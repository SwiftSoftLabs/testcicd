import { taskPluginOAuthCallbackUrl } from './oauth';
import type { ExternalTaskContainer, NormalizedPluginTask } from './types';
import { mapExternalPriority } from './status-map';

const TRELLO_API = 'https://api.trello.com/1';

export function trelloAuthorizeUrl(state: string): string {
    const key = process.env.TRELLO_API_KEY?.trim();
    if (!key) throw new Error('TRELLO_API_KEY is not configured');
    const params = new URLSearchParams({
        key,
        name: 'OneWork',
        scope: 'read,write',
        expiration: 'never',
        response_type: 'token',
        return_url: `${taskPluginOAuthCallbackUrl('trello')}?state=${encodeURIComponent(state)}`,
    });
    return `https://trello.com/1/authorize?${params.toString()}`;
}

function authQuery(token: string): string {
    const key = process.env.TRELLO_API_KEY?.trim();
    if (!key) throw new Error('TRELLO_API_KEY is not configured');
    return `key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
}

async function trelloGet<T>(token: string, path: string): Promise<T> {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${TRELLO_API}${path}${sep}${authQuery(token)}`);
    const data = (await res.json()) as T & { message?: string };
    if (!res.ok) throw new Error(data.message || `Trello API ${path} failed`);
    return data;
}

export async function fetchTrelloMember(token: string) {
    return trelloGet<{ id: string; fullName?: string; username?: string; email?: string }>(
        token,
        '/members/me?fields=fullName,username,email',
    );
}

export async function listTrelloBoards(token: string): Promise<ExternalTaskContainer[]> {
    const boards = await trelloGet<Array<{ id: string; name: string; closed?: boolean }>>(
        token,
        '/members/me/boards?filter=open&fields=name',
    );
    return boards.map((b) => ({
        id: `board:${b.id}`,
        name: b.name,
    }));
}

export async function pullTrelloBoardTasks(
    token: string,
    externalContainerId: string,
): Promise<NormalizedPluginTask[]> {
    const boardId = externalContainerId.replace(/^board:/, '');
    const [lists, cards] = await Promise.all([
        trelloGet<Array<{ id: string; name: string }>>(token, `/boards/${boardId}/lists?fields=name`),
        trelloGet<
            Array<{
                id: string;
                name: string;
                desc?: string;
                due?: string | null;
                idList: string;
                dateLastActivity?: string;
                closed?: boolean;
            }>
        >(token, `/boards/${boardId}/cards?filter=open&fields=name,desc,due,idList,dateLastActivity,closed`),
    ]);
    const listById = new Map(lists.map((l) => [l.id, l.name]));
    return cards
        .filter((c) => !c.closed)
        .map((c) => {
            const listName = listById.get(c.idList) ?? 'Unknown';
            return {
                externalId: c.id,
                title: c.name?.trim() || '(Untitled)',
                description: c.desc?.trim() || null,
                externalStatus: listName,
                statusCategory: /done|complete/i.test(listName)
                    ? 'done'
                    : /progress|doing/i.test(listName)
                      ? 'in_progress'
                      : 'todo',
                priority: mapExternalPriority(undefined),
                dueDate: c.due ? c.due.slice(0, 10) : null,
                externalUpdatedAt: c.dateLastActivity ?? null,
            } satisfies NormalizedPluginTask;
        });
}

export async function updateTrelloCard(
    token: string,
    externalTaskId: string,
    update: { title?: string; description?: string | null; dueDate?: string | null; listId?: string },
): Promise<void> {
    const params = new URLSearchParams();
    if (update.title) params.set('name', update.title);
    if (update.description !== undefined) params.set('desc', update.description ?? '');
    if (update.dueDate !== undefined) params.set('due', update.dueDate ?? '');
    if (update.listId) params.set('idList', update.listId);
    const sep = authQuery(token);
    const res = await fetch(`${TRELLO_API}/cards/${externalTaskId}?${sep}&${params.toString()}`, {
        method: 'PUT',
    });
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message || 'Trello card update failed');
    }
}

export async function trelloListIdForStatus(
    token: string,
    boardId: string,
    oneworkStatus: string,
    statusMap: Record<string, string>,
): Promise<string | null> {
    const lists = await trelloGet<Array<{ id: string; name: string }>>(
        token,
        `/boards/${boardId.replace(/^board:/, '')}/lists?fields=name`,
    );
    for (const [listName, mapped] of Object.entries(statusMap)) {
        if (mapped === oneworkStatus) {
            const hit = lists.find((l) => l.name === listName);
            if (hit) return hit.id;
        }
    }
    const fallback = lists.find((l) => {
        if (oneworkStatus === 'done') return /done|complete/i.test(l.name);
        if (oneworkStatus === 'in-progress' || oneworkStatus === 'review') {
            return /progress|doing|review/i.test(l.name);
        }
        return /to do|todo|backlog/i.test(l.name);
    });
    return fallback?.id ?? lists[0]?.id ?? null;
}
