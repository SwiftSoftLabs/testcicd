import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { requireVaultApiUser } from '@/lib/vault/mfa-route';
import { MfaEnrollmentRequiredError, MfaStepUpRequiredError } from '@/lib/mfa/guard';
import { requireVaultMaxMember } from '@/lib/vault/auth';
import { generateCliToken } from '@/lib/vault/cli-tokens';
import { query, SCHEMA } from '@/lib/db';
import type { VaultCliToken } from '@/types/vault';
import {
    checkVaultCliRateLimit,
    vaultCliRateLimitResponse,
    VAULT_CLI_CREATE_LIMIT,
    VAULT_CLI_CREATE_WINDOW_MS,
} from '@/lib/vault/cli-rate-limit';

const bodySchema = z.object({
    tokenId: z.string().uuid(),
    projectId: z.string().uuid(),
});

// POST /api/vault/cli-tokens/rotate — atomically issue a new token with the
// same scopes and remaining-equivalent TTL, and revoke the old one. Returns
// the new plaintext exactly once, matching the create endpoint's shape.
export async function POST(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
                { status: 400 },
            );
        }
        const { tokenId, projectId } = parsed.data;

        const { workspaceId, isAdmin } = await requireVaultMaxMember(projectId, user.id);

        const createRate = checkVaultCliRateLimit(
            `vault-cli:create:${user.id}`,
            VAULT_CLI_CREATE_LIMIT,
            VAULT_CLI_CREATE_WINDOW_MS,
        );
        if (!createRate.allowed) {
            return vaultCliRateLimitResponse(createRate.retryAfterMs);
        }

        const existing = await query<{
            id: string;
            name: string;
            revoked_at: string | null;
            expires_at: string;
            user_id: string;
        }>(
            `SELECT id, name, revoked_at, expires_at, user_id
             FROM ${SCHEMA}.vault_cli_tokens
             WHERE id = $1 AND project_id = $2
               AND ($3::boolean OR user_id = $4)
             LIMIT 1`,
            [tokenId, projectId, isAdmin, user.id],
        );
        if (existing.rowCount === 0) {
            return NextResponse.json({ error: 'Token not found' }, { status: 404 });
        }
        const row = existing.rows[0];
        if (row.revoked_at || new Date(row.expires_at) <= new Date()) {
            return NextResponse.json(
                { error: 'Token is already revoked or expired' },
                { status: 410 },
            );
        }

        const { plaintext, hash, lookup } = generateCliToken();

        const result = await query<VaultCliToken>(
            `WITH old AS (
                 UPDATE ${SCHEMA}.vault_cli_tokens
                 SET revoked_at = NOW()
                 WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
                   AND ($5::boolean OR user_id = $6)
                 RETURNING id, project_id, workspace_id, user_id, name, scopes, allowed_environments, expires_at, created_at
             )
             INSERT INTO ${SCHEMA}.vault_cli_tokens
                 (project_id, workspace_id, user_id, name, token_hash, token_lookup, scopes, allowed_environments, expires_at)
             SELECT
                 project_id,
                 workspace_id,
                 user_id,
                 CASE WHEN name LIKE '% (rotated)' THEN name ELSE name || ' (rotated)' END,
                 $3,
                 $4,
                 scopes,
                 allowed_environments,
                 NOW() + (expires_at - created_at)
             FROM old
             RETURNING id, project_id, workspace_id, user_id, name, scopes, allowed_environments,
                       expires_at, last_used_at, revoked_at, created_at`,
            [tokenId, projectId, hash, lookup, isAdmin, user.id],
        );

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: 'Token is already revoked or expired' },
                { status: 410 },
            );
        }

        const newToken = result.rows[0];

        query(
            `INSERT INTO ${SCHEMA}.vault_audit_log
                (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, metadata)
             VALUES
                ($1, $2, $3, 'cli_token.rotated', 'cli_token', $4, $5),
                ($1, $2, $3, 'cli_token.created', 'cli_token', $6, $7)`,
            [
                projectId,
                workspaceId,
                user.id,
                tokenId,
                JSON.stringify({ tokenName: row.name, rotatedToTokenId: newToken.id }),
                newToken.id,
                JSON.stringify({
                    tokenName: newToken.name,
                    scopes: newToken.scopes,
                    allowedEnvironments: newToken.allowed_environments,
                    rotatedFromTokenId: tokenId,
                }),
            ],
        ).catch((err) => console.error('[vault audit]', err));

        const response = NextResponse.json({ data: { ...newToken, plaintext } });
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return response;
    } catch (e) {
        if (e instanceof MfaStepUpRequiredError || e instanceof MfaEnrollmentRequiredError) {
            return NextResponse.json(
                { error: e.message, code: e.code },
                { status: e.status },
            );
        }
        if (e instanceof WorkspaceAccessError) {
            const extra = (e as WorkspaceAccessError & { requiredPlan?: string }).requiredPlan;
            return NextResponse.json(
                { error: e.message, ...(extra ? { requiredPlan: extra } : {}) },
                { status: e.status ?? 403 },
            );
        }
        console.error('[vault/cli-tokens/rotate]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
