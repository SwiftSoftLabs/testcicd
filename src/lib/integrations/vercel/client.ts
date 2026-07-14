import type {
    VercelCreatedDeployment,
    VercelCreatedProject,
    VercelDeploymentSummary,
    VercelProject,
    VercelWebhookSummary,
} from './types';

const VERCEL_API = 'https://api.vercel.com';

async function vercelFetch(path: string, token: string, teamId: string, init?: RequestInit): Promise<Response> {
    const url = new URL(path.startsWith('http') ? path : `${VERCEL_API}${path}`);
    url.searchParams.set('teamId', teamId);
    return fetch(url.toString(), {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...init?.headers,
        },
        cache: 'no-store',
    });
}

async function vercelJsonOrThrow<T>(res: Response, label: string): Promise<T> {
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`${label} (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
}

export async function listVercelProjects(accessToken: string, teamId: string): Promise<VercelProject[]> {
    const res = await vercelFetch('/v9/projects', accessToken, teamId);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to list Vercel projects (${res.status}): ${text}`);
    }
    const data = await res.json() as { projects: { id: string; name: string; framework?: string | null }[] };
    return (data.projects ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        framework: p.framework ?? null,
    }));
}

export type VercelEnvTarget = 'production' | 'preview' | 'development';

export async function upsertVercelEnvVar(
    accessToken: string,
    teamId: string,
    projectId: string,
    key: string,
    value: string,
    targets: VercelEnvTarget[]
): Promise<void> {
    const url = new URL(`${VERCEL_API}/v9/projects/${encodeURIComponent(projectId)}/env`);
    url.searchParams.set('teamId', teamId);
    url.searchParams.set('upsert', 'true');

    const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, value, type: 'encrypted', target: targets }),
        cache: 'no-store',
    });

    if (res.status === 403) {
        throw new Error('Vercel integration lacks permission to manage env vars. Reconnect Vercel.');
    }
    if (res.status === 404) {
        throw new Error(`Vercel project not found: ${projectId}`);
    }
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Vercel API error (${res.status}): ${text}`);
    }
}

export async function getVercelProject(
    accessToken: string,
    teamId: string,
    nameOrId: string,
): Promise<VercelCreatedProject | null> {
    const res = await vercelFetch(
        `/v9/projects/${encodeURIComponent(nameOrId)}`,
        accessToken,
        teamId,
    );
    if (res.status === 404) return null;
    const data = await vercelJsonOrThrow<{ id: string; name: string }>(
        res,
        'Failed to get Vercel project',
    );
    return { id: data.id, name: data.name };
}

/** Create a project, or return the existing one when the name already exists (409). */
export async function ensureVercelProject(
    accessToken: string,
    teamId: string,
    name: string,
    framework?: string | null,
): Promise<VercelCreatedProject> {
    const res = await vercelFetch('/v9/projects', accessToken, teamId, {
        method: 'POST',
        body: JSON.stringify({
            name,
            framework: framework ?? null,
        }),
    });

    if (res.status === 409) {
        const existing = await getVercelProject(accessToken, teamId, name);
        if (existing) return existing;
        throw new Error(
            `Vercel project "${name}" already exists but could not be loaded`,
        );
    }

    const data = await vercelJsonOrThrow<{ id: string; name: string }>(
        res,
        'Failed to create Vercel project',
    );
    return { id: data.id, name: data.name };
}

export async function createVercelProject(
    accessToken: string,
    teamId: string,
    name: string,
    framework?: string | null,
): Promise<VercelCreatedProject> {
    return ensureVercelProject(accessToken, teamId, name, framework);
}

export type VercelGitCustomHostSource = {
    type: 'github-custom-host';
    host: string;
    org: string;
    repo: string;
    ref?: string;
    sha?: string;
};

export async function createVercelDeployment(
    accessToken: string,
    teamId: string,
    projectId: string,
    projectName: string,
    gitSource: VercelGitCustomHostSource,
    target?: 'production' | 'preview',
): Promise<VercelCreatedDeployment> {
    const res = await vercelFetch('/v13/deployments', accessToken, teamId, {
        method: 'POST',
        body: JSON.stringify({
            name: projectName,
            project: projectId,
            target: target ?? undefined,
            gitSource,
        }),
    });
    const data = await vercelJsonOrThrow<{
        id: string;
        url: string | null;
        readyState?: string;
        status?: string;
    }>(res, 'Failed to create Vercel deployment');
    return {
        id: data.id,
        url: data.url ?? null,
        readyState: data.readyState ?? data.status ?? 'QUEUED',
    };
}

export async function listVercelDeployments(
    accessToken: string,
    teamId: string,
    projectId: string,
    limit = 5,
): Promise<VercelDeploymentSummary[]> {
    const url = new URL(`${VERCEL_API}/v6/deployments`);
    url.searchParams.set('teamId', teamId);
    url.searchParams.set('projectId', projectId);
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url.toString(), {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        cache: 'no-store',
    });
    const data = await vercelJsonOrThrow<{
        deployments?: Array<{
            uid: string;
            url: string | null;
            state: string;
            target: 'production' | 'preview' | null;
            meta?: Record<string, string>;
            createdAt: number;
        }>;
    }>(res, 'Failed to list Vercel deployments');
    return (data.deployments ?? []).map((d) => ({
        id: d.uid,
        url: d.url ? `https://${d.url}` : null,
        state: d.state,
        target: d.target ?? null,
        meta: d.meta,
        createdAt: d.createdAt,
    }));
}

const DEPLOYMENT_WEBHOOK_EVENTS = [
    'deployment.created',
    'deployment.succeeded',
    'deployment.error',
    'deployment.canceled',
] as const;

export async function createVercelWebhook(
    accessToken: string,
    teamId: string,
    callbackUrl: string,
): Promise<VercelWebhookSummary> {
    const res = await vercelFetch('/v1/webhooks', accessToken, teamId, {
        method: 'POST',
        body: JSON.stringify({
            url: callbackUrl,
            events: [...DEPLOYMENT_WEBHOOK_EVENTS],
        }),
    });
    const data = await vercelJsonOrThrow<{
        id: string;
        url: string;
        events: string[];
    }>(res, 'Failed to create Vercel webhook');
    return { id: data.id, url: data.url, events: data.events ?? [] };
}

export async function deleteVercelWebhook(
    accessToken: string,
    teamId: string,
    webhookId: string,
): Promise<void> {
    const res = await vercelFetch(`/v1/webhooks/${encodeURIComponent(webhookId)}`, accessToken, teamId, {
        method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
        const text = await res.text();
        throw new Error(`Failed to delete Vercel webhook (${res.status}): ${text}`);
    }
}
