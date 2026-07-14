import { taskPluginOAuthCallbackUrl } from './oauth';
import type { ExternalTaskContainer, NormalizedPluginTask } from './types';
import { mapExternalPriority } from './status-map';

const CLICKUP_API = 'https://api.clickup.com/api/v2';

export function clickUpOAuthAuthorizeUrl(state: string): string {
    const clientId = process.env.CLICKUP_CLIENT_ID?.trim();
    if (!clientId) throw new Error('CLICKUP_CLIENT_ID is not configured');
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: taskPluginOAuthCallbackUrl('clickup'),
        state,
    });
    return `https://app.clickup.com/api?${params.toString()}`;
}

export async function exchangeClickUpCode(code: string) {
    const clientId = process.env.CLICKUP_CLIENT_ID?.trim();
    const clientSecret = process.env.CLICKUP_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('ClickUp OAuth is not configured');
    const res = await fetch(`${CLICKUP_API}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
        }),
    });
    const data = (await res.json()) as { access_token?: string; error?: string };
    if (!res.ok || !data.access_token) {
        throw new Error(data.error || 'ClickUp token exchange failed');
    }
    return data.access_token;
}

async function clickUpGet<T>(token: string, path: string): Promise<T> {
    const res = await fetch(`${CLICKUP_API}${path}`, {
        headers: { Authorization: token },
    });
    const data = (await res.json()) as T & { err?: string };
    if (!res.ok) throw new Error(data.err || `ClickUp API ${path} failed`);
    return data;
}

export async function fetchClickUpUser(token: string) {
    const teams = await clickUpGet<{ teams?: Array<{ id: string; name: string }> }>(token, '/team');
    const team = teams.teams?.[0];
    return {
        id: team?.id ?? 'clickup',
        name: team?.name ?? 'ClickUp',
        email: null as string | null,
    };
}

export async function listClickUpContainers(token: string): Promise<ExternalTaskContainer[]> {
    const teams = await clickUpGet<{ teams?: Array<{ id: string; name: string }> }>(token, '/team');
    const containers: ExternalTaskContainer[] = [];
    for (const team of teams.teams ?? []) {
        const spaces = await clickUpGet<{ spaces?: Array<{ id: string; name: string }> }>(
            token,
            `/team/${team.id}/space?archived=false`,
        );
        for (const space of spaces.spaces ?? []) {
            const folders = await clickUpGet<{
                folders?: Array<{ id: string; name: string; lists?: Array<{ id: string; name: string }> }>;
            }>(token, `/space/${space.id}/folder?archived=false`);
            for (const folder of folders.folders ?? []) {
                for (const list of folder.lists ?? []) {
                    containers.push({
                        id: `list:${list.id}`,
                        name: list.name,
                        subtitle: `${team.name} / ${space.name} / ${folder.name}`,
                    });
                }
            }
            const folderless = await clickUpGet<{ lists?: Array<{ id: string; name: string }> }>(
                token,
                `/space/${space.id}/list?archived=false`,
            );
            for (const list of folderless.lists ?? []) {
                containers.push({
                    id: `list:${list.id}`,
                    name: list.name,
                    subtitle: `${team.name} / ${space.name}`,
                });
            }
        }
    }
    return containers.sort((a, b) => `${a.subtitle ?? ''}/${a.name}`.localeCompare(`${b.subtitle ?? ''}/${b.name}`));
}

export async function pullClickUpListTasks(
    token: string,
    externalContainerId: string,
): Promise<NormalizedPluginTask[]> {
    const listId = externalContainerId.replace(/^list:/, '');
    const data = await clickUpGet<{
        tasks?: Array<{
            id: string;
            name: string;
            description?: string;
            status?: { status?: string; type?: string };
            priority?: { priority?: string } | null;
            due_date?: string | null;
            date_updated?: string;
            assignees?: Array<{ email?: string }>;
        }>;
    }>(token, `/list/${listId}/task?archived=false&include_closed=false`);
    return (data.tasks ?? []).map((t) => {
        const statusName = t.status?.status ?? 'unknown';
        const type = t.status?.type;
        return {
            externalId: t.id,
            title: t.name?.trim() || '(Untitled)',
            description: t.description?.trim() || null,
            externalStatus: statusName,
            statusCategory:
                type === 'closed' || type === 'done'
                    ? 'done'
                    : type === 'custom' && /progress|active/i.test(statusName)
                      ? 'in_progress'
                      : 'todo',
            priority: mapExternalPriority(t.priority?.priority),
            dueDate: t.due_date ? new Date(Number(t.due_date)).toISOString().slice(0, 10) : null,
            externalUpdatedAt: t.date_updated
                ? new Date(Number(t.date_updated)).toISOString()
                : null,
            assigneeEmail: t.assignees?.[0]?.email ?? null,
        } satisfies NormalizedPluginTask;
    });
}

export async function resolveClickUpListStatusName(
    token: string,
    listId: string,
    targetStatusName: string,
): Promise<string> {
    const data = await clickUpGet<{
        statuses?: Array<{ status?: string; type?: string }>;
    }>(token, `/list/${listId}`);
    const target = targetStatusName.trim().toLowerCase();
    const statuses = data.statuses ?? [];
    const exact = statuses.find((s) => s.status?.trim().toLowerCase() === target);
    if (exact?.status) return exact.status;
    const partial = statuses.find((s) => {
        const name = s.status?.trim().toLowerCase() ?? '';
        return name.includes(target) || target.includes(name);
    });
    if (partial?.status) return partial.status;
    return targetStatusName;
}

export async function updateClickUpTask(
    token: string,
    externalTaskId: string,
    update: { title?: string; description?: string | null; status?: string },
    opts?: { listId?: string },
): Promise<void> {
    const body: Record<string, unknown> = {};
    if (update.title) body.name = update.title;
    if (update.description !== undefined) body.description = update.description ?? '';
    if (update.status) {
        body.status = opts?.listId
            ? await resolveClickUpListStatusName(token, opts.listId, update.status)
            : update.status;
    }
    const res = await fetch(`${CLICKUP_API}/task/${externalTaskId}`, {
        method: 'PUT',
        headers: {
            Authorization: token,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { err?: string };
        throw new Error(data.err || 'ClickUp task update failed');
    }
}
