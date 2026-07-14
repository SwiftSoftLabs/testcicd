import { taskPluginOAuthCallbackUrl } from './oauth';
import type { ExternalTaskContainer, NormalizedPluginTask } from './types';
import { mapExternalPriority } from './status-map';

const ATLASSIAN_AUTH = 'https://auth.atlassian.com';
const ATLASSIAN_API = 'https://api.atlassian.com';

export const JIRA_SCOPES = [
    'read:jira-work',
    'write:jira-work',
    'read:me',
    'offline_access',
].join(' ');

export function jiraOAuthAuthorizeUrl(state: string): string {
    const clientId = process.env.ATLASSIAN_CLIENT_ID?.trim();
    if (!clientId) throw new Error('ATLASSIAN_CLIENT_ID is not configured');
    const params = new URLSearchParams({
        audience: 'api.atlassian.com',
        client_id: clientId,
        scope: JIRA_SCOPES,
        redirect_uri: taskPluginOAuthCallbackUrl('jira'),
        state,
        response_type: 'code',
        prompt: 'consent',
    });
    return `${ATLASSIAN_AUTH}/authorize?${params.toString()}`;
}

export async function exchangeJiraCode(code: string) {
    const clientId = process.env.ATLASSIAN_CLIENT_ID?.trim();
    const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('Atlassian OAuth is not configured');
    const res = await fetch(`${ATLASSIAN_AUTH}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: taskPluginOAuthCallbackUrl('jira'),
        }),
    });
    const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
    };
    if (!res.ok || !data.access_token) {
        throw new Error(data.error || 'Jira token exchange failed');
    }
    const resources = await fetchAccessibleResources(data.access_token);
    const site = resources[0];
    if (!site) throw new Error('No accessible Jira sites for this account');
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresIn: data.expires_in ?? 3600,
        accountId: site.id,
        accountName: site.name,
        accountEmail: null as string | null,
        cloudId: site.id,
        siteUrl: site.url,
    };
}

export async function refreshJiraToken(refreshToken: string) {
    const clientId = process.env.ATLASSIAN_CLIENT_ID?.trim();
    const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('Atlassian OAuth is not configured');
    const res = await fetch(`${ATLASSIAN_AUTH}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
    };
    if (!res.ok) throw new Error(data.error || 'Jira token refresh failed');
    return data;
}

async function fetchAccessibleResources(accessToken: string) {
    const res = await fetch(`${ATLASSIAN_API}/oauth/token/accessible-resources`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as Array<{ id: string; name: string; url: string; scopes?: string[] }>;
    if (!res.ok) throw new Error('Failed to list Jira sites');
    return data.filter((r) => r.scopes?.includes('read:jira-work') || true);
}

function jiraApi(token: string, cloudId: string, path: string) {
    return `${ATLASSIAN_API}/ex/jira/${cloudId}${path}`;
}

export async function listJiraProjects(
    token: string,
    cloudId: string,
): Promise<ExternalTaskContainer[]> {
    const res = await fetch(jiraApi(token, cloudId, '/rest/api/3/project/search?maxResults=50'), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const data = (await res.json()) as {
        values?: Array<{ id: string; key: string; name: string }>;
        errorMessages?: string[];
    };
    if (!res.ok) throw new Error(data.errorMessages?.[0] || 'Failed to list Jira projects');
    return (data.values ?? []).map((p) => ({
        id: `project:${p.key}`,
        name: p.name,
        subtitle: p.key,
    }));
}

export async function pullJiraProjectTasks(
    token: string,
    cloudId: string,
    externalContainerId: string,
): Promise<NormalizedPluginTask[]> {
    const projectKey = externalContainerId.replace(/^project:/, '');
    const res = await fetch(jiraApi(token, cloudId, '/rest/api/3/search'), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jql: `project = "${projectKey}" AND statusCategory != Done ORDER BY updated DESC`,
            maxResults: 50,
            fields: ['summary', 'description', 'status', 'priority', 'duedate', 'updated', 'assignee'],
        }),
    });
    const data = (await res.json()) as {
        issues?: Array<{
            id: string;
            key: string;
            fields?: {
                summary?: string;
                description?: { content?: unknown } | string | null;
                status?: { name?: string; statusCategory?: { key?: string } };
                priority?: { name?: string };
                duedate?: string | null;
                updated?: string;
                assignee?: { emailAddress?: string };
            };
        }>;
        errorMessages?: string[];
    };
    if (!res.ok) throw new Error(data.errorMessages?.[0] || 'Jira search failed');

    return (data.issues ?? []).map((issue) => {
        const f = issue.fields ?? {};
        const statusName = f.status?.name ?? 'Unknown';
        const cat = f.status?.statusCategory?.key;
        let description: string | null = null;
        if (typeof f.description === 'string') description = f.description;
        return {
            externalId: issue.id,
            title: `${issue.key}: ${f.summary?.trim() || '(Untitled)'}`,
            description,
            externalStatus: statusName,
            statusCategory:
                cat === 'done'
                    ? 'done'
                    : cat === 'indeterminate'
                      ? 'in_progress'
                      : 'todo',
            priority: mapExternalPriority(f.priority?.name),
            dueDate: f.duedate ?? null,
            externalUpdatedAt: f.updated ?? null,
            assigneeEmail: f.assignee?.emailAddress ?? null,
        } satisfies NormalizedPluginTask;
    });
}

export async function transitionJiraIssue(
    token: string,
    cloudId: string,
    externalTaskId: string,
    targetStatusName: string,
): Promise<void> {
    const transRes = await fetch(
        jiraApi(token, cloudId, `/rest/api/3/issue/${externalTaskId}/transitions`),
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );
    const transData = (await transRes.json()) as {
        transitions?: Array<{ id: string; name?: string; to?: { name?: string } }>;
        errorMessages?: string[];
    };
    if (!transRes.ok) {
        throw new Error(transData.errorMessages?.[0] || 'Failed to load Jira transitions');
    }

    const target = targetStatusName.trim().toLowerCase();
    const transition = (transData.transitions ?? []).find((t) => {
        const toName = t.to?.name?.trim().toLowerCase();
        const name = t.name?.trim().toLowerCase();
        return toName === target || name === target;
    });
    if (!transition) {
        throw new Error(`No Jira transition found for status "${targetStatusName}"`);
    }

    const res = await fetch(
        jiraApi(token, cloudId, `/rest/api/3/issue/${externalTaskId}/transitions`),
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ transition: { id: transition.id } }),
        },
    );
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { errorMessages?: string[] };
        throw new Error(data.errorMessages?.[0] || 'Jira status transition failed');
    }
}

export async function updateJiraIssue(
    token: string,
    cloudId: string,
    externalTaskId: string,
    update: { title?: string; description?: string | null; status?: string },
): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (update.title) {
        const summary = update.title.replace(/^[A-Z]+-\d+:\s*/, '');
        fields.summary = summary;
    }
    if (update.description !== undefined) {
        fields.description = update.description
            ? {
                  type: 'doc',
                  version: 1,
                  content: [
                      {
                          type: 'paragraph',
                          content: [{ type: 'text', text: update.description }],
                      },
                  ],
              }
            : null;
    }
    const res = await fetch(jiraApi(token, cloudId, `/rest/api/3/issue/${externalTaskId}`), {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { errorMessages?: string[] };
        throw new Error(data.errorMessages?.[0] || 'Jira issue update failed');
    }

    if (update.status) {
        await transitionJiraIssue(token, cloudId, externalTaskId, update.status);
    }
}

export function getJiraCloudId(installation: { settings: Record<string, unknown> }): string {
    const cloudId = installation.settings?.cloudId;
    if (typeof cloudId !== 'string' || !cloudId) {
        throw new Error('Jira cloud id missing — reconnect Jira');
    }
    return cloudId;
}
