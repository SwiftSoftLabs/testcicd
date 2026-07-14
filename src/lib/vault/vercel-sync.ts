import { query, SCHEMA } from '@/lib/db';
import { decryptVercelToken } from '@/lib/integrations/vercel/crypto';
import { upsertVercelEnvVar } from '@/lib/integrations/vercel/client';
import type { VercelEnvTarget } from '@/lib/integrations/vercel/client';
import { getProjectDek } from './keys';
import { decryptValue } from './crypto';
import type { VaultSyncTarget, VaultSyncEvent, VaultVariableRow } from '@/types/vault';
import type { VercelIntegrationRow } from '@/lib/integrations/vercel/types';

export interface SyncResult {
    pushed: number;
    failed: { name: string; error: string }[];
    syncEventId: string;
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

export async function syncProjectToVercel(
    projectId: string,
    workspaceId: string,
    syncTargetId: string,
    actorId: string,
): Promise<SyncResult> {
    // Load and IDOR-guard the sync target
    const targetResult = await query<VaultSyncTarget>(
        `SELECT * FROM ${SCHEMA}.vault_sync_targets WHERE id = $1 AND project_id = $2 AND provider = 'vercel' LIMIT 1`,
        [syncTargetId, projectId]
    );
    const target = targetResult.rows[0];
    if (!target) {
        throw new Error('Sync target not found');
    }

    const { vercelProjectId, targets: envTargets, variableMode, selectedVariableNames, vaultEnvironmentId } = target.config as {
        vercelProjectId: string;
        targets: VercelEnvTarget[];
        variableMode: 'all' | 'subset';
        selectedVariableNames?: string[];
        vaultEnvironmentId: string;
    };

    // Load Vercel integration for this workspace
    const integrationResult = await query<VercelIntegrationRow>(
        `SELECT * FROM ${SCHEMA}.vercel_integrations WHERE workspace_id = $1 ORDER BY updated_at DESC LIMIT 1`,
        [workspaceId]
    );
    const integration = integrationResult.rows[0];
    if (!integration) {
        throw new Error('Vercel is not connected. Connect Vercel in Settings → Integrations.');
    }

    const accessToken = decryptVercelToken(integration.access_token_enc);
    const teamId = integration.target_id;

    // Insert sync event with status=running
    const eventResult = await query<VaultSyncEvent>(
        `INSERT INTO ${SCHEMA}.vault_sync_events (sync_target_id, status, metadata)
         VALUES ($1, 'running', $2) RETURNING *`,
        [syncTargetId, JSON.stringify({ triggeredBy: actorId })]
    );
    const syncEventId = eventResult.rows[0].id;

    await appendAudit(projectId, workspaceId, actorId, 'sync.started', {
        syncTargetId,
        syncEventId,
    }, syncTargetId);

    try {
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

        const dek = await getProjectDek(projectId);

        const failed: { name: string; error: string }[] = [];
        let pushed = 0;

        for (const v of variables) {
            try {
                const plaintext = decryptValue({ ciphertext: v.ciphertext, iv: v.iv, authTag: v.auth_tag }, dek);
                await upsertVercelEnvVar(accessToken, teamId, vercelProjectId, v.name, plaintext, envTargets);
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
