import { taskPluginOAuthCallbackUrl } from './oauth';
import type { ExternalTaskContainer, NormalizedPluginTask } from './types';
import { mapExternalPriority } from './status-map';
import type { Status } from '@/types';

const ASANA_API = 'https://app.asana.com/api/1.0';
const ASANA_OAUTH = 'https://app.asana.com/-/oauth_authorize';
const ASANA_TOKEN = 'https://app.asana.com/-/oauth_token';

type AsanaEnvelope<T> = { data?: T; errors?: Array<{ message?: string }> };

async function asanaRequest<T>(
    token: string,
    path: string,
    init?: RequestInit,
): Promise<T> {
    const res = await fetch(`${ASANA_API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...init?.headers,
        },
    });
    const json = (await res.json().catch(() => ({}))) as AsanaEnvelope<T>;
    if (!res.ok) {
        throw new Error(json.errors?.[0]?.message || `Asana API ${path} failed`);
    }
    return json.data as T;
}

function oauthFormBody(params: Record<string, string>): string {
    return new URLSearchParams(params).toString();
}

export function asanaOAuthAuthorizeUrl(state: string): string {
    const clientId = process.env.ASANA_CLIENT_ID?.trim();
    if (!clientId) throw new Error('ASANA_CLIENT_ID is not configured');
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: taskPluginOAuthCallbackUrl('asana'),
        response_type: 'code',
        state,
    });
    return `${ASANA_OAUTH}?${params.toString()}`;
}

export async function exchangeAsanaCode(code: string) {
    const clientId = process.env.ASANA_CLIENT_ID?.trim();
    const clientSecret = process.env.ASANA_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('Asana OAuth is not configured');
    const res = await fetch(ASANA_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: oauthFormBody({
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: taskPluginOAuthCallbackUrl('asana'),
            code,
        }),
    });
    const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        data?: { gid?: string; name?: string; email?: string };
        error?: string;
        error_description?: string;
    };
    if (!res.ok || !data.access_token) {
        throw new Error(data.error_description || data.error || 'Asana token exchange failed');
    }
    const me = await fetchAsanaUser(data.access_token);
    const workspace = me.workspaces?.[0];
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresIn: data.expires_in ?? 3600,
        accountId: me.gid,
        accountName: me.name ?? 'Asana',
        accountEmail: me.email ?? null,
        workspaceGid: workspace?.gid ?? null,
        workspaceName: workspace?.name ?? null,
    };
}

export async function refreshAsanaToken(refreshToken: string) {
    const clientId = process.env.ASANA_CLIENT_ID?.trim();
    const clientSecret = process.env.ASANA_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('Asana OAuth is not configured');
    const res = await fetch(ASANA_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: oauthFormBody({
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
        }),
    });
    const data = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        error?: string;
        error_description?: string;
    };
    if (!res.ok) throw new Error(data.error_description || data.error || 'Asana token refresh failed');
    return data;
}

export async function fetchAsanaUser(token: string) {
    return asanaRequest<{
        gid: string;
        name?: string;
        email?: string;
        workspaces?: Array<{ gid: string; name?: string }>;
    }>(token, '/users/me?opt_fields=name,email,workspaces,workspaces.name');
}

export function getAsanaWorkspaceGid(installation: { settings: Record<string, unknown> }): string {
    const gid = installation.settings?.workspaceGid;
    if (typeof gid !== 'string' || !gid) {
        throw new Error('Asana workspace missing — reconnect Asana');
    }
    return gid;
}

export async function listAsanaProjects(
    token: string,
    workspaceGid: string,
): Promise<ExternalTaskContainer[]> {
    const projects = await asanaRequest<Array<{ gid: string; name: string; workspace?: { name?: string } }>>(
        token,
        `/projects?workspace=${encodeURIComponent(workspaceGid)}&archived=false&limit=100&opt_fields=name,workspace.name`,
    );
    return (projects ?? []).map((p) => ({
        id: `project:${p.gid}`,
        name: p.name,
        subtitle: p.workspace?.name,
    }));
}

function sectionNameForTask(
    memberships: Array<{ project?: { gid?: string }; section?: { name?: string } }> | undefined,
    projectGid: string,
): string {
    const hit = (memberships ?? []).find((m) => m.project?.gid === projectGid);
    return hit?.section?.name ?? 'Unknown';
}

export async function pullAsanaProjectTasks(
    token: string,
    externalContainerId: string,
): Promise<NormalizedPluginTask[]> {
    const projectGid = externalContainerId.replace(/^project:/, '');
    const tasks = await asanaRequest<
        Array<{
            gid: string;
            name?: string;
            notes?: string;
            completed?: boolean;
            due_on?: string | null;
            modified_at?: string;
            assignee?: { email?: string };
            memberships?: Array<{ project?: { gid?: string }; section?: { name?: string } }>;
        }>
    >(
        token,
        `/tasks?project=${encodeURIComponent(projectGid)}&completed=false&limit=50&opt_fields=name,notes,completed,due_on,modified_at,assignee.email,memberships.project.gid,memberships.section.name`,
    );

    return (tasks ?? []).map((t) => {
        const sectionName = sectionNameForTask(t.memberships, projectGid);
        return {
            externalId: t.gid,
            title: t.name?.trim() || '(Untitled)',
            description: t.notes?.trim() || null,
            externalStatus: sectionName,
            statusCategory: t.completed
                ? 'done'
                : /progress|doing|active|review/i.test(sectionName)
                  ? 'in_progress'
                  : 'todo',
            priority: mapExternalPriority(undefined),
            dueDate: t.due_on ?? null,
            externalUpdatedAt: t.modified_at ?? null,
            assigneeEmail: t.assignee?.email ?? null,
        } satisfies NormalizedPluginTask;
    });
}

export async function asanaSectionGidForStatus(
    token: string,
    projectGid: string,
    oneworkStatus: Status | string,
    statusMap: Record<string, string>,
): Promise<string | null> {
    const sections = await asanaRequest<Array<{ gid: string; name: string }>>(
        token,
        `/projects/${projectGid.replace(/^project:/, '')}/sections?opt_fields=name`,
    );
    for (const [sectionName, mapped] of Object.entries(statusMap)) {
        if (mapped === oneworkStatus) {
            const hit = sections.find((s) => s.name === sectionName);
            if (hit) return hit.gid;
        }
    }
    const fallback = sections.find((s) => {
        if (oneworkStatus === 'done') return /done|complete/i.test(s.name);
        if (oneworkStatus === 'in-progress' || oneworkStatus === 'review') {
            return /progress|doing|review|active/i.test(s.name);
        }
        return /to do|todo|backlog|upcoming/i.test(s.name);
    });
    return fallback?.gid ?? sections[0]?.gid ?? null;
}

export async function addAsanaTaskToSection(
    token: string,
    sectionGid: string,
    taskGid: string,
): Promise<void> {
    await asanaRequest(token, `/sections/${sectionGid}/addTask`, {
        method: 'POST',
        body: JSON.stringify({ data: { task: taskGid } }),
    });
}

export async function updateAsanaTask(
    token: string,
    externalTaskId: string,
    update: {
        title?: string;
        description?: string | null;
        dueDate?: string | null;
        completed?: boolean;
        sectionGid?: string;
    },
): Promise<void> {
    const data: Record<string, unknown> = {};
    if (update.title) data.name = update.title;
    if (update.description !== undefined) data.notes = update.description ?? '';
    if (update.dueDate !== undefined) data.due_on = update.dueDate;
    if (update.completed !== undefined) data.completed = update.completed;

    if (Object.keys(data).length > 0) {
        await asanaRequest(token, `/tasks/${externalTaskId}`, {
            method: 'PUT',
            body: JSON.stringify({ data }),
        });
    }

    if (update.sectionGid) {
        await addAsanaTaskToSection(token, update.sectionGid, externalTaskId);
    }
}
