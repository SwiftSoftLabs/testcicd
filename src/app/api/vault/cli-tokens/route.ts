import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { requireVaultApiUser } from '@/lib/vault/mfa-route';
import { vaultRouteErrorResponse } from '@/lib/vault/handle-vault-route-error';
import { requireVaultMaxMember } from '@/lib/vault/auth';
import { generateCliToken, getProjectCliTokenCount } from '@/lib/vault/cli-tokens';
import { query, SCHEMA } from '@/lib/db';
import type { VaultCliToken } from '@/types/vault';
import {
    checkVaultCliRateLimit,
    vaultCliRateLimitResponse,
    VAULT_CLI_CREATE_LIMIT,
    VAULT_CLI_CREATE_WINDOW_MS,
} from '@/lib/vault/cli-rate-limit';
import { normalizeAllowedEnvironments, VAULT_CLI_READ_SCOPE } from '@/lib/vault/cli-scope';

const MAX_TOKENS_PER_PROJECT = 10;
const DEFAULT_EXPIRES_DAYS = 30;
const MAX_EXPIRES_DAYS_MEMBER = 90;
const MAX_EXPIRES_DAYS_ADMIN = 365;

const createSchema = z.object({
    projectId: z.string().uuid(),
    name: z.string().min(1).max(64),
    expiresInDays: z.number().int().min(1).max(MAX_EXPIRES_DAYS_ADMIN).default(DEFAULT_EXPIRES_DAYS),
    allowedEnvironments: z.array(z.string().min(1).max(64)).max(10).optional(),
});

const deleteSchema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
});

// GET /api/vault/cli-tokens?projectId=
export async function GET(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const { searchParams } = new URL(request.url);
        const projectId = searchParams.get('projectId');
        if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 });

        const { isAdmin } = await requireVaultMaxMember(projectId, user.id);

        const result = await query<VaultCliToken>(
            `SELECT id, project_id, workspace_id, user_id, name, scopes, allowed_environments,
                    expires_at, last_used_at, revoked_at, created_at
             FROM ${SCHEMA}.vault_cli_tokens
             WHERE project_id = $1
               AND ($2::boolean OR user_id = $3)
             ORDER BY created_at DESC`,
            [projectId, isAdmin, user.id],
        );

        return NextResponse.json({ data: result.rows });
    } catch (e) {
        const vaultErr = vaultRouteErrorResponse(e);
        if (vaultErr) return vaultErr;
        if (e instanceof WorkspaceAccessError) {
            const extra = (e as WorkspaceAccessError & { requiredPlan?: string }).requiredPlan;
            return NextResponse.json(
                { error: e.message, ...(extra ? { requiredPlan: extra } : {}) },
                { status: e.status ?? 403 },
            );
        }
        console.error('[vault/cli-tokens GET]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// POST /api/vault/cli-tokens — create, returns plaintext once
export async function POST(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = createSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
        }
        const { projectId, name, allowedEnvironments } = parsed.data;
        let { expiresInDays } = parsed.data;

        const { workspaceId, isAdmin } = await requireVaultMaxMember(projectId, user.id);

        const createRate = checkVaultCliRateLimit(
            `vault-cli:create:${user.id}`,
            VAULT_CLI_CREATE_LIMIT,
            VAULT_CLI_CREATE_WINDOW_MS,
        );
        if (!createRate.allowed) {
            return vaultCliRateLimitResponse(createRate.retryAfterMs);
        }

        const expiresCap = isAdmin ? MAX_EXPIRES_DAYS_ADMIN : MAX_EXPIRES_DAYS_MEMBER;
        if (expiresInDays > expiresCap) {
            expiresInDays = expiresCap;
        }

        const tokenCount = await getProjectCliTokenCount(projectId);
        if (tokenCount >= MAX_TOKENS_PER_PROJECT) {
            return NextResponse.json(
                { error: `Max ${MAX_TOKENS_PER_PROJECT} active tokens per project. Revoke an existing token first.` },
                { status: 422 },
            );
        }

        const allowed =
            allowedEnvironments && allowedEnvironments.length > 0
                ? normalizeAllowedEnvironments(allowedEnvironments)
                : null;

        const { plaintext, hash, lookup } = generateCliToken();
        const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
        const scopes = [VAULT_CLI_READ_SCOPE];

        const result = await query<VaultCliToken>(
            `INSERT INTO ${SCHEMA}.vault_cli_tokens
                (project_id, workspace_id, user_id, name, token_hash, token_lookup, scopes, allowed_environments, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, project_id, workspace_id, user_id, name, scopes, allowed_environments,
                       expires_at, last_used_at, revoked_at, created_at`,
            [projectId, workspaceId, user.id, name, hash, lookup, scopes, allowed, expiresAt],
        );

        const token = result.rows[0];

        query(
            `INSERT INTO ${SCHEMA}.vault_audit_log
                (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, metadata)
             VALUES ($1, $2, $3, 'cli_token.created', 'cli_token', $4, $5)`,
            [
                projectId,
                workspaceId,
                user.id,
                token.id,
                JSON.stringify({
                    tokenName: name,
                    expiresInDays,
                    scopes,
                    allowedEnvironments: allowed,
                }),
            ],
        ).catch((err) => console.error('[vault audit]', err));

        const response = NextResponse.json({ data: { ...token, plaintext } });
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return response;
    } catch (e) {
        const vaultErr = vaultRouteErrorResponse(e);
        if (vaultErr) return vaultErr;
        if (e instanceof WorkspaceAccessError) {
            const extra = (e as WorkspaceAccessError & { requiredPlan?: string }).requiredPlan;
            return NextResponse.json(
                { error: e.message, ...(extra ? { requiredPlan: extra } : {}) },
                { status: e.status ?? 403 },
            );
        }
        console.error('[vault/cli-tokens POST]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/vault/cli-tokens — revoke
export async function DELETE(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = deleteSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
        }
        const { id, projectId } = parsed.data;

        const { workspaceId, isAdmin } = await requireVaultMaxMember(projectId, user.id);

        const result = await query<{ id: string; name: string }>(
            `UPDATE ${SCHEMA}.vault_cli_tokens
             SET revoked_at = NOW()
             WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL
               AND ($3::boolean OR user_id = $4)
             RETURNING id, name`,
            [id, projectId, isAdmin, user.id],
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Token not found or already revoked' }, { status: 404 });
        }

        query(
            `INSERT INTO ${SCHEMA}.vault_audit_log
                (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, metadata)
             VALUES ($1, $2, $3, 'cli_token.revoked', 'cli_token', $4, $5)`,
            [projectId, workspaceId, user.id, id, JSON.stringify({ tokenName: result.rows[0].name, revokedBy: 'user' })],
        ).catch((err) => console.error('[vault audit]', err));

        return NextResponse.json({ data: { id } });
    } catch (e) {
        const vaultErr = vaultRouteErrorResponse(e);
        if (vaultErr) return vaultErr;
        if (e instanceof WorkspaceAccessError) {
            const extra = (e as WorkspaceAccessError & { requiredPlan?: string }).requiredPlan;
            return NextResponse.json(
                { error: e.message, ...(extra ? { requiredPlan: extra } : {}) },
                { status: e.status ?? 403 },
            );
        }
        console.error('[vault/cli-tokens DELETE]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
