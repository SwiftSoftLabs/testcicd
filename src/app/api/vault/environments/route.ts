import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { requireVaultApiUser } from '@/lib/vault/mfa-route';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireVaultAdmin, getVaultLimits } from '@/lib/vault/auth';
import { vaultRouteErrorResponse } from '@/lib/vault/handle-vault-route-error';
import { query, SCHEMA } from '@/lib/db';
import type { VaultEnvironment } from '@/types/vault';

const createSchema = z.object({
    projectId: z.string().uuid(),
    name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Name may only contain letters, numbers, hyphens, and underscores'),
    description: z.string().max(255).optional(),
});

const updateSchema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    description: z.string().max(255).optional(),
});

const deleteSchema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
});

function appendAudit(
    projectId: string,
    workspaceId: string,
    actorId: string,
    eventType: string,
    metadata: Record<string, unknown>,
    environmentId?: string
) {
    query(
        `INSERT INTO ${SCHEMA}.vault_audit_log
            (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, environment_id, metadata)
         VALUES ($1, $2, $3, $4, 'environment', $5, $6, $7)`,
        [projectId, workspaceId, actorId, eventType, environmentId ?? null, environmentId ?? null, JSON.stringify(metadata)]
    ).catch((err) => console.error('[vault audit]', err));
}

// POST /api/vault/environments
export async function POST(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = createSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
                { status: 400 }
            );
        }
        const { projectId, name, description } = parsed.data;

        const { workspaceId } = await requireVaultAdmin(projectId, user.id);
        try { await assertProjectWritable(projectId); } catch (e) { const r = toAccessResponse(e); if (r) return r; throw e; }

        // Check plan environment limit (per project)
        const { limits } = await getVaultLimits(projectId);
        const countResult = await query<{ cnt: string }>(
            `SELECT COUNT(*)::int AS cnt FROM ${SCHEMA}.vault_environments WHERE project_id = $1`,
            [projectId]
        );
        const currentCount = Number(countResult.rows[0]?.cnt ?? 0);
        if (currentCount >= limits.maxEnvironments) {
            return NextResponse.json(
                { error: `Environment limit reached (${limits.maxEnvironments} for your plan). Upgrade to add more.` },
                { status: 400 }
            );
        }

        const result = await query<VaultEnvironment>(
            `INSERT INTO ${SCHEMA}.vault_environments
                (project_id, workspace_id, name, description, is_system, created_by)
             VALUES ($1, $2, $3, $4, false, $5)
             RETURNING *`,
            [projectId, workspaceId, name, description ?? null, user.id]
        );

        const env = result.rows[0];
        appendAudit(projectId, workspaceId, user.id, 'environment.created', { environmentName: name }, env.id);

        return NextResponse.json({ data: env }, { status: 201 });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('duplicate key') || msg.includes('unique')) {
            return NextResponse.json(
                { error: 'An environment with this name already exists.' },
                { status: 409 }
            );
        }
        console.error('[vault/environments POST]', e);
        return vaultRouteErrorResponse(e);
    }
}

// PATCH /api/vault/environments
export async function PATCH(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = updateSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
                { status: 400 }
            );
        }
        const { id, projectId, name, description } = parsed.data;

        const { workspaceId } = await requireVaultAdmin(projectId, user.id);

        // Block rename of system environments
        const envCheck = await query<{ is_system: boolean; name: string }>(
            `SELECT is_system, name FROM ${SCHEMA}.vault_environments
             WHERE id = $1 AND project_id = $2 LIMIT 1`,
            [id, projectId]
        );
        if (envCheck.rowCount === 0) {
            return NextResponse.json({ error: 'Environment not found' }, { status: 404 });
        }
        const existing = envCheck.rows[0];
        if (existing.is_system && name && name !== existing.name) {
            return NextResponse.json(
                { error: 'System environments cannot be renamed.' },
                { status: 400 }
            );
        }

        const result = await query<VaultEnvironment>(
            `UPDATE ${SCHEMA}.vault_environments
             SET name = COALESCE($2, name),
                 description = COALESCE($3, description),
                 updated_at = NOW()
             WHERE id = $1 AND project_id = $4
             RETURNING *`,
            [id, name ?? null, description ?? null, projectId]
        );

        const env = result.rows[0];
        appendAudit(projectId, workspaceId, user.id, 'environment.renamed', {
            from: existing.name,
            to: env.name,
        }, id);

        return NextResponse.json({ data: env });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('duplicate key') || msg.includes('unique')) {
            return NextResponse.json(
                { error: 'An environment with this name already exists.' },
                { status: 409 }
            );
        }
        console.error('[vault/environments PATCH]', e);
        return vaultRouteErrorResponse(e);
    }
}

// DELETE /api/vault/environments
export async function DELETE(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = deleteSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
        }
        const { id, projectId } = parsed.data;

        const { workspaceId } = await requireVaultAdmin(projectId, user.id);
        try { await assertProjectWritable(projectId); } catch (e) { const r = toAccessResponse(e); if (r) return r; throw e; }

        // Check existence, system flag, and variable count in one query
        const checkResult = await query<{ is_system: boolean; name: string; var_count: string }>(
            `SELECT e.is_system, e.name, COUNT(v.id)::int AS var_count
             FROM ${SCHEMA}.vault_environments e
             LEFT JOIN ${SCHEMA}.vault_variables v ON v.environment_id = e.id
             WHERE e.id = $1 AND e.project_id = $2
             GROUP BY e.id, e.is_system, e.name`,
            [id, projectId]
        );

        if (checkResult.rowCount === 0) {
            return NextResponse.json({ error: 'Environment not found' }, { status: 404 });
        }

        const { is_system, name, var_count } = checkResult.rows[0];
        const varCount = Number(var_count);

        if (is_system) {
            return NextResponse.json(
                { error: 'System environments cannot be deleted.' },
                { status: 400 }
            );
        }
        if (varCount > 0) {
            return NextResponse.json(
                { error: `Delete all ${varCount} variable${varCount === 1 ? '' : 's'} in this environment before deleting it.` },
                { status: 400 }
            );
        }

        await query(
            `DELETE FROM ${SCHEMA}.vault_environments WHERE id = $1 AND project_id = $2`,
            [id, projectId]
        );

        appendAudit(projectId, workspaceId, user.id, 'environment.deleted', {
            environmentName: name,
            variableCount: varCount,
        }, id);

        return NextResponse.json({ data: { id } });
    } catch (e: unknown) {
        console.error('[vault/environments DELETE]', e);
        return vaultRouteErrorResponse(e);
    }
}
