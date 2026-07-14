import { query, SCHEMA } from '@/lib/db';
import { findIntegration } from '@/lib/integrations/git/repository';
import { decryptGitToken } from '@/lib/integrations/git/crypto';
import { getProjectDek } from './keys';
import { decryptValue } from './crypto';
import { sealForGitHub } from './sealed-box';
import type { VaultSyncTarget, VaultSyncEvent, VaultVariableRow, VaultSyncTargetGithubConfig } from '@/types/vault';

export interface SyncResult {
    pushed: number;
    failed: { name: string; error: string }[];
    syncEventId: string;
}

interface GitHubPublicKey {
    key_id: string;
    key: string;
}

async function ghFetchWithToken(path: string, token: string, init?: RequestInit): Promise<Response> {
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    return fetch(url, {
        ...init,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            ...init?.headers,
        },
        cache: 'no-store',
    });
}

async function fetchRepoPublicKey(
    owner: string,
    repo: string,
    environmentName: string | null | undefined,
    token: string
): Promise<GitHubPublicKey> {
    const e = encodeURIComponent(owner);
    const r = encodeURIComponent(repo);
    const path = environmentName
        ? `/repos/${e}/${r}/environments/${encodeURIComponent(environmentName)}/secrets/public-key`
        : `/repos/${e}/${r}/actions/secrets/public-key`;

    const res = await ghFetchWithToken(path, token);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch GitHub public key (${res.status}): ${text}`);
    }
    return res.json() as Promise<GitHubPublicKey>;
}

async function putSecret(
    owner: string,
    repo: string,
    secretName: string,
    encryptedValue: string,
    keyId: string,
    environmentName: string | null | undefined,
    token: string
): Promise<void> {
    const e = encodeURIComponent(owner);
    const r = encodeURIComponent(repo);
    const n = encodeURIComponent(secretName);
    const path = environmentName
        ? `/repos/${e}/${r}/environments/${encodeURIComponent(environmentName)}/secrets/${n}`
        : `/repos/${e}/${r}/actions/secrets/${n}`;

    const res = await ghFetchWithToken(path, token, {
        method: 'PUT',
        body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId }),
    });

    if (res.status === 403) {
        throw new Error('GitHub integration lacks secrets permission. Reconnect GitHub to grant secrets access.');
    }
    if (res.status === 404) {
        throw new Error(`Repository or environment not found: ${owner}/${repo}${environmentName ? ` (env: ${environmentName})` : ''}`);
    }
    if (!res.ok && res.status !== 201 && res.status !== 204) {
        const text = await res.text();
        throw new Error(`GitHub API error (${res.status}): ${text}`);
    }
}

async function appendAudit(
    projectId: string,
    workspaceId: string,
    actorId: string,
    eventType: string,
    metadata: Record<string, unknown>,
    resourceId?: string
) {
    query(
        `INSERT INTO ${SCHEMA}.vault_audit_log
            (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, metadata)
         VALUES ($1, $2, $3, $4, 'sync', $5, $6)`,
        [projectId, workspaceId, actorId, eventType, resourceId ?? null, JSON.stringify(metadata)]
    ).catch((err) => console.error('[vault audit]', err));
}

export async function syncProjectToGitHub(
    projectId: string,
    workspaceId: string,
    syncTargetId: string,
    actorId: string,
): Promise<SyncResult> {
    // Load and verify sync target belongs to this project (IDOR guard)
    const targetResult = await query<VaultSyncTarget>(
        `SELECT * FROM ${SCHEMA}.vault_sync_targets WHERE id = $1 AND project_id = $2 AND provider = 'github' LIMIT 1`,
        [syncTargetId, projectId]
    );
    const target = targetResult.rows[0];
    if (!target) {
        throw new Error('Sync target not found');
    }

    const { owner, repo, environmentName, variableMode, selectedVariableNames, vaultEnvironmentId } = target.config as VaultSyncTargetGithubConfig;

    // Load and decrypt GitHub OAuth token for the acting user
    const integration = await findIntegration(workspaceId, actorId, 'github');
    if (!integration || !integration.encrypted_token) {
        throw new Error('GitHub integration not connected. Connect GitHub in Settings → Git & SSH.');
    }
    const accessToken = decryptGitToken(integration.encrypted_token);

    // Insert sync event with status=running
    const eventResult = await query<VaultSyncEvent>(
        `INSERT INTO ${SCHEMA}.vault_sync_events (sync_target_id, status, metadata)
         VALUES ($1, 'running', $2) RETURNING *`,
        [syncTargetId, JSON.stringify({ triggeredBy: actorId })]
    );
    const syncEvent = eventResult.rows[0];
    const syncEventId = syncEvent.id;

    await appendAudit(projectId, workspaceId, actorId, 'sync.started', {
        syncTargetId,
        syncEventId,
    }, syncTargetId);

    try {
        // Fetch GitHub public key for this repo/environment
        const pubKey = await fetchRepoPublicKey(owner, repo, environmentName, accessToken);

        // Load variables to sync
        let variableQuery: string;
        let variableParams: unknown[];
        if (variableMode === 'subset' && selectedVariableNames?.length) {
            variableQuery = `SELECT id, name, ciphertext, iv, auth_tag FROM ${SCHEMA}.vault_variables
                             WHERE project_id = $1 AND environment_id = $2 AND name = ANY($3::text[])
                             ORDER BY name ASC`;
            variableParams = [projectId, vaultEnvironmentId, selectedVariableNames];
        } else {
            variableQuery = `SELECT id, name, ciphertext, iv, auth_tag FROM ${SCHEMA}.vault_variables
                             WHERE project_id = $1 AND environment_id = $2
                             ORDER BY name ASC`;
            variableParams = [projectId, vaultEnvironmentId];
        }

        const varResult = await query<Pick<VaultVariableRow, 'id' | 'name' | 'ciphertext' | 'iv' | 'auth_tag'>>(
            variableQuery,
            variableParams
        );
        const variables = varResult.rows;

        // Single DEK fetch for the project
        const dek = await getProjectDek(projectId);

        const failed: { name: string; error: string }[] = [];
        let pushed = 0;

        for (const v of variables) {
            try {
                // Decrypt in memory
                const plaintext = decryptValue({ ciphertext: v.ciphertext, iv: v.iv, authTag: v.auth_tag }, dek);
                // Sealed-box encrypt for GitHub
                const encryptedValue = await sealForGitHub(plaintext, pubKey.key);
                // Push to GitHub
                await putSecret(owner, repo, v.name, encryptedValue, pubKey.key_id, environmentName, accessToken);
                pushed++;
            } catch (err) {
                failed.push({ name: v.name, error: err instanceof Error ? err.message : String(err) });
            }
        }

        const finalStatus = failed.length > 0 && pushed === 0 ? 'failed' : 'completed';
        const eventMeta = { pushed, failedCount: failed.length, triggeredBy: actorId };

        await query(
            `UPDATE ${SCHEMA}.vault_sync_events SET status = $1, metadata = $2, updated_at = NOW() WHERE id = $3`,
            [finalStatus, JSON.stringify({ ...eventMeta, failed }), syncEventId]
        );

        const auditType = finalStatus === 'completed' ? 'sync.completed' : 'sync.failed';
        await appendAudit(projectId, workspaceId, actorId, auditType, eventMeta, syncTargetId);

        return { pushed, failed, syncEventId };
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await query(
            `UPDATE ${SCHEMA}.vault_sync_events SET status = 'failed', metadata = $1, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify({ error: errorMessage, triggeredBy: actorId }), syncEventId]
        );
        await appendAudit(projectId, workspaceId, actorId, 'sync.failed', { syncTargetId, syncEventId, error: errorMessage }, syncTargetId);
        throw err;
    }
}
