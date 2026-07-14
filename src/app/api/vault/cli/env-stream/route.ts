import { NextResponse } from 'next/server';
import { verifyCliToken } from '@/lib/vault/cli-tokens';
import {
    assertVaultMaxForProject,
    canSeeProtectedEnv,
} from '@/lib/vault/auth';
import {
    requireWorkspaceMember,
    WorkspaceAccessError,
    isWorkspaceAdmin,
} from '@/lib/rbac/workspace-access';
import { getProjectDek } from '@/lib/vault/keys';
import { decryptValue } from '@/lib/vault/crypto';
import { query, SCHEMA } from '@/lib/db';
import type { VaultVariableRow } from '@/types/vault';
import {
    getClientIp,
    logCliAuthFailed,
    logCliEnvDenied,
} from '@/lib/vault/cli-audit';
import {
    checkVaultCliRateLimit,
    vaultCliRateLimitResponse,
    VAULT_CLI_FAIL_LIMIT,
    VAULT_CLI_FAIL_WINDOW_MS,
    VAULT_CLI_PULL_LIMIT,
    VAULT_CLI_PULL_WINDOW_MS,
} from '@/lib/vault/cli-rate-limit';
import {
    isEnvironmentAllowedByToken,
    tokenHasVaultReadScope,
} from '@/lib/vault/cli-scope';
import { isCliTokenFormat } from '@/lib/vault/cli-token-lookup';

const GENERIC_AUTH_ERROR = 'Invalid or expired token';

// GET /api/vault/cli/env-stream
// Called by the onework CLI. Auth via Bearer token, not session cookie.
export async function GET(request: Request) {
    const ip = getClientIp(request);

    try {
        const authHeader = request.headers.get('Authorization');
        const presented = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

        const { searchParams } = new URL(request.url);
        const projectId = searchParams.get('projectId');
        const environmentName = searchParams.get('environment') ?? 'production';

        if (!projectId) {
            return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
        }

        if (!presented) {
            await logCliAuthFailed({ projectId, ip, reason: 'missing_auth' });
            return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
        }

        const failKey = `vault-cli:fail:${ip}`;
        const failRate = checkVaultCliRateLimit(failKey, VAULT_CLI_FAIL_LIMIT, VAULT_CLI_FAIL_WINDOW_MS);
        if (!failRate.allowed) {
            await logCliAuthFailed({ projectId, ip, reason: 'rate_limit' });
            return vaultCliRateLimitResponse(failRate.retryAfterMs);
        }

        if (!isCliTokenFormat(presented)) {
            await logCliAuthFailed({ projectId, ip, reason: 'invalid_token' });
            return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
        }

        const tokenRow = await verifyCliToken(presented);
        if (!tokenRow) {
            await logCliAuthFailed({ projectId, ip, reason: 'invalid_token' });
            return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
        }

        const pullRate = checkVaultCliRateLimit(
            `vault-cli:token:${tokenRow.id}`,
            VAULT_CLI_PULL_LIMIT,
            VAULT_CLI_PULL_WINDOW_MS,
        );
        if (!pullRate.allowed) {
            await logCliEnvDenied({
                projectId,
                workspaceId: tokenRow.workspace_id,
                actorId: tokenRow.user_id,
                tokenId: tokenRow.id,
                environment: environmentName,
                ip,
                reason: 'rate_limit',
            });
            return vaultCliRateLimitResponse(pullRate.retryAfterMs);
        }

        if (!tokenHasVaultReadScope(tokenRow.scopes)) {
            await logCliEnvDenied({
                projectId,
                workspaceId: tokenRow.workspace_id,
                actorId: tokenRow.user_id,
                tokenId: tokenRow.id,
                environment: environmentName,
                ip,
                reason: 'scope',
            });
            return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 403 });
        }

        if (tokenRow.project_id !== projectId) {
            await logCliEnvDenied({
                projectId,
                workspaceId: tokenRow.workspace_id,
                actorId: tokenRow.user_id,
                tokenId: tokenRow.id,
                environment: environmentName,
                ip,
                reason: 'wrong_project',
            });
            return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 403 });
        }

        let membership;
        try {
            membership = await requireWorkspaceMember(tokenRow.workspace_id, tokenRow.user_id);
        } catch (e) {
            if (e instanceof WorkspaceAccessError) {
                await logCliEnvDenied({
                    projectId,
                    workspaceId: tokenRow.workspace_id,
                    actorId: tokenRow.user_id,
                    tokenId: tokenRow.id,
                    environment: environmentName,
                    ip,
                    reason: 'not_member',
                });
                return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 403 });
            }
            throw e;
        }

        try {
            await assertVaultMaxForProject(projectId);
        } catch (e) {
            if (e instanceof WorkspaceAccessError) {
                await logCliEnvDenied({
                    projectId,
                    workspaceId: tokenRow.workspace_id,
                    actorId: tokenRow.user_id,
                    tokenId: tokenRow.id,
                    environment: environmentName,
                    ip,
                    reason: 'plan',
                });
                const extra = (e as WorkspaceAccessError & { requiredPlan?: string }).requiredPlan;
                return NextResponse.json(
                    { error: e.message, ...(extra ? { requiredPlan: extra } : {}) },
                    { status: e.status ?? 403 },
                );
            }
            throw e;
        }

        const envResult = await query<{ id: string; name: string }>(
            `SELECT id, name FROM ${SCHEMA}.vault_environments
             WHERE project_id = $1 AND LOWER(name) = LOWER($2)
             LIMIT 1`,
            [projectId, environmentName],
        );
        const environment = envResult.rows[0];
        if (!environment) {
            return NextResponse.json(
                { error: `Environment "${environmentName}" not found in this project` },
                { status: 404 },
            );
        }

        if (!isEnvironmentAllowedByToken(tokenRow.allowed_environments, environment.name)) {
            await logCliEnvDenied({
                projectId,
                workspaceId: tokenRow.workspace_id,
                actorId: tokenRow.user_id,
                tokenId: tokenRow.id,
                environment: environment.name,
                ip,
                reason: 'env_not_allowed',
            });
            return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 403 });
        }

        const ownerIsAdmin = isWorkspaceAdmin(membership);
        if (!canSeeProtectedEnv(ownerIsAdmin, environment.name)) {
            await logCliEnvDenied({
                projectId,
                workspaceId: tokenRow.workspace_id,
                actorId: tokenRow.user_id,
                tokenId: tokenRow.id,
                environment: environment.name,
                ip,
                reason: 'env_forbidden',
            });
            return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 403 });
        }

        const varResult = await query<Pick<VaultVariableRow, 'name' | 'ciphertext' | 'iv' | 'auth_tag'>>(
            `SELECT name, ciphertext, iv, auth_tag FROM ${SCHEMA}.vault_variables
             WHERE project_id = $1 AND environment_id = $2
             ORDER BY name ASC`,
            [projectId, environment.id],
        );

        const dek = await getProjectDek(projectId);
        const vars: Record<string, string> = {};

        for (const v of varResult.rows) {
            try {
                vars[v.name] = decryptValue({ ciphertext: v.ciphertext, iv: v.iv, authTag: v.auth_tag }, dek);
            } catch (err) {
                console.error(`[env-stream] Failed to decrypt ${v.name}:`, err);
            }
        }

        await query(
            `INSERT INTO ${SCHEMA}.vault_audit_log
                (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, metadata)
             VALUES ($1, $2, $3, 'cli_env.pulled', 'cli_token', $4, $5)`,
            [
                projectId,
                tokenRow.workspace_id,
                tokenRow.user_id,
                tokenRow.id,
                JSON.stringify({
                    tokenId: tokenRow.id,
                    environmentName: environment.name,
                    variableCount: Object.keys(vars).length,
                    ip,
                }),
            ],
        ).catch((err) => console.error('[vault audit]', err));

        query(
            `UPDATE ${SCHEMA}.vault_cli_tokens SET last_used_at = NOW() WHERE id = $1`,
            [tokenRow.id],
        ).catch(() => {});

        const response = NextResponse.json({
            data: { environment: environment.name, vars },
        });
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return response;
    } catch (e: unknown) {
        console.error('[vault/cli/env-stream]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
