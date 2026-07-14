import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { requireVaultApiUser } from '@/lib/vault/mfa-route';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireVaultMember, getVaultLimits, canSeeProtectedEnv, assertEnvWritable } from '@/lib/vault/auth';
import { vaultRouteErrorResponse } from '@/lib/vault/handle-vault-route-error';
import { getProjectDek } from '@/lib/vault/keys';
import { encryptValue } from '@/lib/vault/crypto';
import { query, SCHEMA } from '@/lib/db';
import type { VaultVariableMeta, VaultVariableRow } from '@/types/vault';
import { VAULT_VARIABLE_NAME_REGEX } from '@/lib/vault/variable-names';

const createSchema = z.object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    name: z.string().regex(VAULT_VARIABLE_NAME_REGEX, 'Variable name must match ^[A-Z_][A-Z0-9_]{0,127}$'),
    value: z.string().min(1, 'Value cannot be empty').max(16384, 'Value exceeds 16 KB limit'),
});

const updateSchema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    value: z.string().min(1).max(16384),
    updatedAt: z.string(),
});

const deleteSchema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    updatedAt: z.string(),
});

const listSchema = z.object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
});

function toMeta(row: VaultVariableRow): VaultVariableMeta {
    return {
        id: row.id,
        project_id: row.project_id,
        workspace_id: row.workspace_id,
        environment_id: row.environment_id,
        name: row.name,
        algorithm: row.algorithm,
        key_version: row.key_version,
        created_by: row.created_by,
        updated_by: row.updated_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

async function appendAudit(
    projectId: string,
    workspaceId: string,
    actorId: string,
    eventType: string,
    metadata: Record<string, unknown>,
    resourceId?: string,
    environmentId?: string
) {
    query(
        `INSERT INTO ${SCHEMA}.vault_audit_log
            (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, environment_id, metadata)
         VALUES ($1, $2, $3, $4, 'variable', $5, $6, $7)`,
        [projectId, workspaceId, actorId, eventType, resourceId ?? null, environmentId ?? null, JSON.stringify(metadata)]
    ).catch((err) => console.error('[vault audit]', err));
}

// GET /api/vault/variables?projectId=&environmentId=
export async function GET(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const { searchParams } = new URL(request.url);
        const parsed = listSchema.safeParse({
            projectId: searchParams.get('projectId'),
            environmentId: searchParams.get('environmentId'),
        });
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
        }
        const { projectId, environmentId } = parsed.data;

        // Members can list metadata (no ciphertext returned)
        const { isAdmin } = await requireVaultMember(projectId, user.id);

        // Block non-admins from reading protected envs (e.g. production)
        const envRow = await query<{ name: string }>(
            `SELECT name FROM ${SCHEMA}.vault_environments
             WHERE id = $1 AND project_id = $2 LIMIT 1`,
            [environmentId, projectId]
        );
        if (envRow.rowCount === 0) {
            return NextResponse.json({ error: 'Environment not found' }, { status: 404 });
        }
        if (!canSeeProtectedEnv(isAdmin, envRow.rows[0].name)) {
            return NextResponse.json({ error: 'Admin or owner access required' }, { status: 403 });
        }

        const result = await query<VaultVariableMeta>(
            `SELECT id, project_id, workspace_id, environment_id, name, algorithm, key_version,
                    created_by, updated_by, created_at, updated_at
             FROM ${SCHEMA}.vault_variables
             WHERE project_id = $1 AND environment_id = $2
             ORDER BY name ASC`,
            [projectId, environmentId]
        );

        return NextResponse.json({ data: result.rows });
    } catch (e: unknown) {
        console.error('[vault/variables GET]', e);
        return vaultRouteErrorResponse(e);
    }
}

// POST /api/vault/variables
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
        const { projectId, environmentId, name, value } = parsed.data;

        const { workspaceId, isAdmin } = await requireVaultMember(projectId, user.id);
        try { await assertProjectWritable(projectId); } catch (e) { const r = toAccessResponse(e); if (r) return r; throw e; }

        // Verify environment belongs to this project (IDOR prevention) and resolve name for env gate
        const envCheck = await query<{ name: string }>(
            `SELECT name FROM ${SCHEMA}.vault_environments WHERE id = $1 AND project_id = $2 LIMIT 1`,
            [environmentId, projectId]
        );
        if (envCheck.rowCount === 0) {
            return NextResponse.json({ error: 'Environment not found' }, { status: 404 });
        }
        assertEnvWritable(isAdmin, envCheck.rows[0].name);

        // Check plan variable limit (per environment, as per PRD)
        const { limits } = await getVaultLimits(projectId);
        const countResult = await query<{ cnt: string }>(
            `SELECT COUNT(*)::int AS cnt FROM ${SCHEMA}.vault_variables WHERE project_id = $1 AND environment_id = $2`,
            [projectId, environmentId]
        );
        const currentCount = Number(countResult.rows[0]?.cnt ?? 0);
        if (currentCount >= limits.maxVariables) {
            return NextResponse.json(
                { error: `Variable limit reached (${limits.maxVariables} per environment for your plan). Upgrade to add more.` },
                { status: 400 }
            );
        }

        const dek = await getProjectDek(projectId);
        const { ciphertext, iv, authTag } = encryptValue(value, dek);

        const insertResult = await query<VaultVariableRow>(
            `INSERT INTO ${SCHEMA}.vault_variables
                (project_id, workspace_id, environment_id, name, ciphertext, iv, auth_tag, algorithm, key_version, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'aes-256-gcm', 1, $8, $8)
             RETURNING *`,
            [projectId, workspaceId, environmentId, name, ciphertext, iv, authTag, user.id]
        );

        const row = insertResult.rows[0];

        appendAudit(projectId, workspaceId, user.id, 'variable.created', {
            environmentId,
            environmentName: envCheck.rows[0].name,
            variableName: name,
        }, row.id, environmentId);

        return NextResponse.json({ data: toMeta(row) }, { status: 201 });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '';
        if (msg.includes('duplicate key') || msg.includes('unique')) {
            return NextResponse.json(
                { error: 'A variable with this name already exists in this environment.' },
                { status: 409 }
            );
        }
        console.error('[vault/variables POST]', e);
        return vaultRouteErrorResponse(e);
    }
}

// PATCH /api/vault/variables
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
        const { id, projectId, value, updatedAt } = parsed.data;

        const { workspaceId, isAdmin } = await requireVaultMember(projectId, user.id);
        try { await assertProjectWritable(projectId); } catch (e) { const r = toAccessResponse(e); if (r) return r; throw e; }

        // Resolve env name for the write gate (JOIN on variable → environment)
        const envNameResult = await query<{ env_name: string }>(
            `SELECT e.name AS env_name
             FROM ${SCHEMA}.vault_variables v
             JOIN ${SCHEMA}.vault_environments e ON e.id = v.environment_id
             WHERE v.id = $1 AND v.project_id = $2
             LIMIT 1`,
            [id, projectId]
        );
        if (envNameResult.rowCount === 0) {
            return NextResponse.json({ error: 'Variable not found' }, { status: 404 });
        }
        assertEnvWritable(isAdmin, envNameResult.rows[0].env_name);

        const dek = await getProjectDek(projectId);
        const { ciphertext, iv, authTag } = encryptValue(value, dek);

        const result = await query<VaultVariableRow>(
            `UPDATE ${SCHEMA}.vault_variables
             SET ciphertext = $2, iv = $3, auth_tag = $4, updated_at = NOW(), updated_by = $5
             WHERE id = $1 AND project_id = $6
               AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $7::timestamptz)
             RETURNING *`,
            [id, ciphertext, iv, authTag, user.id, projectId, updatedAt]
        );

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: 'Variable was changed by another user. Refresh and try again.' },
                { status: 409 }
            );
        }

        const row = result.rows[0];
        appendAudit(projectId, workspaceId, user.id, 'variable.updated', {
            variableName: row.name,
            environmentId: row.environment_id,
        }, row.id, row.environment_id);

        return NextResponse.json({ data: toMeta(row) });
    } catch (e: unknown) {
        console.error('[vault/variables PATCH]', e);
        return vaultRouteErrorResponse(e);
    }
}

// DELETE /api/vault/variables
export async function DELETE(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = deleteSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
                { status: 400 }
            );
        }
        const { id, projectId, updatedAt } = parsed.data;

        const { workspaceId, isAdmin } = await requireVaultMember(projectId, user.id);
        try { await assertProjectWritable(projectId); } catch (e) { const r = toAccessResponse(e); if (r) return r; throw e; }

        // Fetch before deleting so we have name/environmentId for the audit log and env gate
        const existing = await query<{ id: string; name: string; environment_id: string; env_name: string }>(
            `SELECT v.id, v.name, v.environment_id, e.name AS env_name
             FROM ${SCHEMA}.vault_variables v
             JOIN ${SCHEMA}.vault_environments e ON e.id = v.environment_id
             WHERE v.id = $1 AND v.project_id = $2 LIMIT 1`,
            [id, projectId]
        );
        if (existing.rowCount === 0) {
            return NextResponse.json({ error: 'Variable not found' }, { status: 404 });
        }
        const { name, environment_id, env_name } = existing.rows[0];
        assertEnvWritable(isAdmin, env_name);

        const result = await query(
            `DELETE FROM ${SCHEMA}.vault_variables
             WHERE id = $1 AND project_id = $2
               AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $3::timestamptz)`,
            [id, projectId, updatedAt]
        );

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: 'Variable was changed by another user. Refresh and try again.' },
                { status: 409 }
            );
        }

        appendAudit(projectId, workspaceId, user.id, 'variable.deleted', {
            variableName: name,
            environmentId: environment_id,
        }, id, environment_id);

        return NextResponse.json({ data: { id } });
    } catch (e: unknown) {
        console.error('[vault/variables DELETE]', e);
        return vaultRouteErrorResponse(e);
    }
}
