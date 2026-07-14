import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { requireVaultApiUser } from '@/lib/vault/mfa-route';
import { vaultRouteErrorResponse } from '@/lib/vault/handle-vault-route-error';
import { requireVaultPro } from '@/lib/vault/auth';
import { findIntegration } from '@/lib/integrations/git/repository';
import { query, SCHEMA } from '@/lib/db';
import type { VaultSyncTarget, VaultSyncTargetGithubConfig } from '@/types/vault';

const githubConfigSchema = z.object({
    provider: z.literal('github'),
    owner: z.string().min(1, 'Owner is required'),
    repo: z.string().min(1, 'Repo is required'),
    installationId: z.string().nullable().optional(),
    environmentName: z.string().nullable().optional(),
    variableMode: z.enum(['all', 'subset']),
    selectedVariableNames: z.array(z.string()).optional(),
    vaultEnvironmentId: z.string().uuid('Vault environment ID is required'),
});

const createSchema = z.object({
    projectId: z.string().uuid(),
    name: z.string().min(1, 'Name is required').max(100),
    config: githubConfigSchema,
});

const updateSchema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    name: z.string().min(1).max(100).optional(),
    config: githubConfigSchema.optional(),
    updatedAt: z.string(),
});

const deleteSchema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
});

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
         VALUES ($1, $2, $3, $4, 'sync_target', $5, $6)`,
        [projectId, workspaceId, actorId, eventType, resourceId ?? null, JSON.stringify(metadata)]
    ).catch((err) => console.error('[vault audit]', err));
}

// POST /api/vault/sync-targets — create a sync target
export async function POST(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = createSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
        }
        const { projectId, name, config } = parsed.data;

        const { workspaceId } = await requireVaultPro(projectId, user.id);

        // Check sync target limit for this project
        const countResult = await query<{ cnt: string }>(
            `SELECT COUNT(*)::int AS cnt FROM ${SCHEMA}.vault_sync_targets WHERE project_id = $1`,
            [projectId]
        );
        const currentCount = Number(countResult.rows[0]?.cnt ?? 0);
        if (currentCount >= 10) {
            return NextResponse.json(
                { error: 'Sync target limit reached (10 per project on Pro). Upgrade to Max to add more.' },
                { status: 400 }
            );
        }

        // Verify GitHub integration is connected for the acting user
        const integration = await findIntegration(workspaceId, user.id, 'github');
        if (!integration) {
            return NextResponse.json(
                { error: 'GitHub integration not connected. Connect GitHub in Settings → Git & SSH.' },
                { status: 400 }
            );
        }

        // Verify vault environment belongs to this project
        const envCheck = await query(
            `SELECT 1 FROM ${SCHEMA}.vault_environments WHERE id = $1 AND project_id = $2 LIMIT 1`,
            [config.vaultEnvironmentId, projectId]
        );
        if (envCheck.rowCount === 0) {
            return NextResponse.json({ error: 'Vault environment not found' }, { status: 404 });
        }

        const insertResult = await query<VaultSyncTarget>(
            `INSERT INTO ${SCHEMA}.vault_sync_targets (project_id, workspace_id, name, provider, config, created_by)
             VALUES ($1, $2, $3, 'github', $4, $5)
             RETURNING *`,
            [projectId, workspaceId, name, JSON.stringify(config), user.id]
        );
        const target = insertResult.rows[0];

        appendAudit(projectId, workspaceId, user.id, 'sync_target.created', {
            name,
            provider: 'github',
            owner: config.owner,
            repo: config.repo,
            environmentName: config.environmentName ?? null,
        }, target.id);

        return NextResponse.json({ data: target }, { status: 201 });
    } catch (e: unknown) {
        const vaultErr = vaultRouteErrorResponse(e);
        if (vaultErr) return vaultErr;
        if (e instanceof WorkspaceAccessError) {
            const extra = (e as WorkspaceAccessError & { requiredPlan?: string }).requiredPlan;
            return NextResponse.json(
                { error: e.message, ...(extra ? { requiredPlan: extra } : {}) },
                { status: e.status ?? 403 }
            );
        }
        console.error('[vault/sync-targets POST]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH /api/vault/sync-targets — update name or config
export async function PATCH(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = updateSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
        }
        const { id, projectId, name, config, updatedAt } = parsed.data;

        const { workspaceId } = await requireVaultPro(projectId, user.id);

        // Build partial update
        const sets: string[] = ['updated_at = NOW()'];
        const values: unknown[] = [];
        let idx = 1;

        if (name !== undefined) { sets.push(`name = $${idx++}`); values.push(name); }
        if (config !== undefined) { sets.push(`config = $${idx++}`); values.push(JSON.stringify(config)); }

        values.push(id, projectId, updatedAt);
        const idIdx = idx++; const pidIdx = idx++; const updIdx = idx++;

        const result = await query<VaultSyncTarget>(
            `UPDATE ${SCHEMA}.vault_sync_targets
             SET ${sets.join(', ')}
             WHERE id = $${idIdx} AND project_id = $${pidIdx}
               AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${updIdx}::timestamptz)
             RETURNING *`,
            values
        );

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: 'Sync target was changed by another user. Refresh and try again.' },
                { status: 409 }
            );
        }

        const updated = result.rows[0];
        appendAudit(projectId, workspaceId, user.id, 'sync_target.updated', {
            name: updated.name,
            provider: updated.provider,
        }, id);

        return NextResponse.json({ data: updated });
    } catch (e: unknown) {
        const vaultErr = vaultRouteErrorResponse(e);
        if (vaultErr) return vaultErr;
        if (e instanceof WorkspaceAccessError) {
            const extra = (e as WorkspaceAccessError & { requiredPlan?: string }).requiredPlan;
            return NextResponse.json(
                { error: e.message, ...(extra ? { requiredPlan: extra } : {}) },
                { status: e.status ?? 403 }
            );
        }
        console.error('[vault/sync-targets PATCH]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/vault/sync-targets
export async function DELETE(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = deleteSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
        }
        const { id, projectId } = parsed.data;

        const { workspaceId } = await requireVaultPro(projectId, user.id);

        const existing = await query<{ name: string }>(
            `SELECT name FROM ${SCHEMA}.vault_sync_targets WHERE id = $1 AND project_id = $2 LIMIT 1`,
            [id, projectId]
        );
        if (existing.rowCount === 0) {
            return NextResponse.json({ error: 'Sync target not found' }, { status: 404 });
        }
        const { name } = existing.rows[0];

        await query(`DELETE FROM ${SCHEMA}.vault_sync_targets WHERE id = $1 AND project_id = $2`, [id, projectId]);

        appendAudit(projectId, workspaceId, user.id, 'sync_target.deleted', { name, provider: 'github' }, id);

        return NextResponse.json({ data: { id } });
    } catch (e: unknown) {
        const vaultErr = vaultRouteErrorResponse(e);
        if (vaultErr) return vaultErr;
        if (e instanceof WorkspaceAccessError) {
            const extra = (e as WorkspaceAccessError & { requiredPlan?: string }).requiredPlan;
            return NextResponse.json(
                { error: e.message, ...(extra ? { requiredPlan: extra } : {}) },
                { status: e.status ?? 403 }
            );
        }
        console.error('[vault/sync-targets DELETE]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// GET /api/vault/sync-targets?projectId=
export async function GET(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const { searchParams } = new URL(request.url);
        const projectId = searchParams.get('projectId');
        if (!projectId) {
            return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
        }

        await requireVaultPro(projectId, user.id);

        const result = await query<VaultSyncTarget & { last_event_status: string | null; last_event_at: string | null; last_pushed: number | null; last_failed: unknown }>(
            `SELECT t.*,
                    e.status AS last_event_status,
                    e.updated_at AS last_event_at,
                    (e.metadata->>'pushed')::int AS last_pushed,
                    e.metadata->'failed' AS last_failed
             FROM ${SCHEMA}.vault_sync_targets t
             LEFT JOIN LATERAL (
                 SELECT status, updated_at, metadata
                 FROM ${SCHEMA}.vault_sync_events
                 WHERE sync_target_id = t.id
                 ORDER BY created_at DESC
                 LIMIT 1
             ) e ON true
             WHERE t.project_id = $1
             ORDER BY t.created_at ASC`,
            [projectId]
        );

        const targets = result.rows.map((row) => ({
            id: row.id,
            project_id: row.project_id,
            workspace_id: row.workspace_id,
            name: row.name,
            provider: row.provider,
            config: row.config,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
            lastEvent: row.last_event_status ? {
                status: row.last_event_status,
                updated_at: row.last_event_at,
                pushed: row.last_pushed,
                failed: row.last_failed,
            } : null,
        }));

        return NextResponse.json({ data: targets });
    } catch (e: unknown) {
        const vaultErr = vaultRouteErrorResponse(e);
        if (vaultErr) return vaultErr;
        if (e instanceof WorkspaceAccessError) {
            const extra = (e as WorkspaceAccessError & { requiredPlan?: string }).requiredPlan;
            return NextResponse.json(
                { error: e.message, ...(extra ? { requiredPlan: extra } : {}) },
                { status: e.status ?? 403 }
            );
        }
        console.error('[vault/sync-targets GET]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
