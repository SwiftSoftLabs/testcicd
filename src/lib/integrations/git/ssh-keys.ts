import { z } from 'zod';

import type { GitProvider, GitSshKey } from '@/types/git';
import { UpstreamError } from './errors';
import {
    createOneworkSshKey,
    deleteOneworkSshKey,
    listOneworkSshKeys,
} from './onework-ssh-keys';
import { fingerprintSha256, normalizePublicKey } from './ssh-key-utils';

const GITHUB_API = 'https://api.github.com';
const GITLAB_API = 'https://gitlab.com/api/v4';

const githubKeySchema = z.object({
    id: z.number(),
    title: z.string(),
    key: z.string(),
    created_at: z.string(),
    read_only: z.boolean().nullish(),
});

const gitlabKeySchema = z.object({
    id: z.number(),
    title: z.string(),
    key: z.string(),
    created_at: z.string(),
    expires_at: z.string().nullable().optional(),
});

async function ghFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
    const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
    return fetch(url, {
        ...init,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...init?.headers,
        },
        cache: 'no-store',
    });
}

async function glFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
    const url = path.startsWith('http') ? path : `${GITLAB_API}${path}`;
    return fetch(url, {
        ...init,
        headers: {
            ...init?.headers,
            'PRIVATE-TOKEN': token,
        },
        cache: 'no-store',
    });
}

function mapGithubKey(row: z.infer<typeof githubKeySchema>): GitSshKey {
    return {
        id: String(row.id),
        title: row.title,
        fingerprint: fingerprintSha256(row.key),
        keyPreview: row.key.split(/\s+/).slice(0, 2).join(' '),
        createdAt: row.created_at,
        readOnly: row.read_only ?? false,
        provider: 'github',
    };
}

function mapGitlabKey(row: z.infer<typeof gitlabKeySchema>): GitSshKey {
    return {
        id: String(row.id),
        title: row.title,
        fingerprint: fingerprintSha256(row.key),
        keyPreview: row.key.split(/\s+/).slice(0, 2).join(' '),
        createdAt: row.created_at,
        readOnly: false,
        provider: 'gitlab',
    };
}

async function parseError(res: Response, fallback: string): Promise<never> {
    let message = fallback;
    try {
        const body = (await res.json()) as { message?: string; error?: string; error_description?: string };
        message = body.message || body.error_description || body.error || message;
    } catch {
        try {
            message = (await res.text()) || message;
        } catch {
            // ignore
        }
    }
    throw new UpstreamError(message, res.status);
}

function parseKeyList<T>(
    rows: unknown,
    schema: z.ZodType<T>,
    map: (row: T) => GitSshKey,
    label: string,
): GitSshKey[] {
    if (!Array.isArray(rows)) {
        throw new UpstreamError(`Unexpected ${label} SSH keys response.`, 502);
    }
    const keys: GitSshKey[] = [];
    for (const row of rows) {
        const parsed = schema.safeParse(row);
        if (!parsed.success) continue;
        try {
            keys.push(map(parsed.data));
        } catch {
            // skip malformed key material
        }
    }
    return keys;
}

export async function listProviderSshKeys(
    provider: GitProvider,
    tokenOrOneworkUsername: string,
): Promise<GitSshKey[]> {
    if (provider === 'onework') {
        return listOneworkSshKeys(tokenOrOneworkUsername);
    }

    const token = tokenOrOneworkUsername;
    if (provider === 'github') {
        const res = await ghFetch('/user/keys', token);
        if (res.status === 403 || res.status === 401) {
            await parseError(res, 'GitHub denied access to SSH keys — reconnect with SSH key permissions.');
        }
        if (!res.ok) await parseError(res, 'Failed to list GitHub SSH keys');
        return parseKeyList(await res.json(), githubKeySchema, mapGithubKey, 'GitHub');
    }

    const res = await glFetch('/user/keys', token);
    if (res.status === 403 || res.status === 401) {
        await parseError(res, 'GitLab denied access to SSH keys — reconnect with the api scope.');
    }
    if (!res.ok) await parseError(res, 'Failed to list GitLab SSH keys');
    return parseKeyList(await res.json(), gitlabKeySchema, mapGitlabKey, 'GitLab');
}

export async function createProviderSshKey(
    provider: GitProvider,
    tokenOrOneworkUsername: string,
    title: string,
    publicKeyRaw: string,
): Promise<GitSshKey> {
    if (provider === 'onework') {
        return createOneworkSshKey(tokenOrOneworkUsername, title, publicKeyRaw);
    }

    const token = tokenOrOneworkUsername;
    const normalized = normalizePublicKey(publicKeyRaw);
    if (!normalized) {
        throw new UpstreamError('Invalid public key. Paste a single-line OpenSSH public key (ssh-ed25519, ssh-rsa, etc.).', 400);
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
        throw new UpstreamError('Key title is required.', 400);
    }

    if (provider === 'github') {
        const res = await ghFetch('/user/keys', token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: trimmedTitle, key: normalized.canonical, read_only: false }),
        });
        if (!res.ok) await parseError(res, 'Failed to add GitHub SSH key');
        return mapGithubKey(githubKeySchema.parse(await res.json()));
    }

    const res = await glFetch('/user/keys', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle, key: normalized.canonical }),
    });
    if (!res.ok) await parseError(res, 'Failed to add GitLab SSH key');
    return mapGitlabKey(gitlabKeySchema.parse(await res.json()));
}

export async function deleteProviderSshKey(
    provider: GitProvider,
    tokenOrOneworkUsername: string,
    keyId: string,
): Promise<void> {
    if (provider === 'onework') {
        return deleteOneworkSshKey(tokenOrOneworkUsername, keyId);
    }

    const token = tokenOrOneworkUsername;
    if (!/^\d+$/.test(keyId)) {
        throw new UpstreamError('Invalid key id.', 400);
    }

    if (provider === 'github') {
        const res = await ghFetch(`/user/keys/${keyId}`, token, { method: 'DELETE' });
        if (res.status === 404) return;
        if (!res.ok && res.status !== 204) await parseError(res, 'Failed to delete GitHub SSH key');
        return;
    }

    const res = await glFetch(`/user/keys/${keyId}`, token, { method: 'DELETE' });
    if (res.status === 404) return;
    if (!res.ok && res.status !== 204) await parseError(res, 'Failed to delete GitLab SSH key');
}
