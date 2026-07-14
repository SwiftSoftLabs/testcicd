import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { requireVaultApiUser } from '@/lib/vault/mfa-route';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireVaultMember, getVaultLimits, assertEnvWritable } from '@/lib/vault/auth';
import { vaultRouteErrorResponse } from '@/lib/vault/handle-vault-route-error';
import { getProjectDek } from '@/lib/vault/keys';
import { encryptValue } from '@/lib/vault/crypto';
import { query, SCHEMA } from '@/lib/db';
import { VAULT_VARIABLE_NAME_REGEX } from '@/lib/vault/variable-names';

const variableSchema = z.object({
    name: z.string().regex(VAULT_VARIABLE_NAME_REGEX),
    value: z.string().max(16384),
});

const bodySchema = z.object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    variables: z.array(variableSchema).min(1).max(200),
    overwrite: z.boolean().default(false),
});

export async function POST(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
                { status: 400 }
            );
        }
        const { projectId, environmentId, variables, overwrite } = parsed.data;

        const { workspaceId, isAdmin } = await requireVaultMember(projectId, user.id);
        try { await assertProjectWritable(projectId); } catch (e) { const r = toAccessResponse(e); if (r) return r; throw e; }

        // Verify environment belongs to this project
        const envCheck = await query<{ name: string }>(
            `SELECT name FROM ${SCHEMA}.vault_environments WHERE id = $1 AND project_id = $2 LIMIT 1`,
            [environmentId, projectId]
        );
        if (envCheck.rowCount === 0) {
            return NextResponse.json({ error: 'Environment not found' }, { status: 404 });
        }
        const environmentName = envCheck.rows[0].name;
        assertEnvWritable(isAdmin, environmentName);

        // Check plan variable limit (per environment)
        const { limits } = await getVaultLimits(projectId);
        const countResult = await query<{ cnt: string }>(
            `SELECT COUNT(*)::int AS cnt FROM ${SCHEMA}.vault_variables WHERE project_id = $1 AND environment_id = $2`,
            [projectId, environmentId]
        );
        const currentCount = Number(countResult.rows[0]?.cnt ?? 0);
        const incomingNames = variables.map((v) => v.name);

        // Step 1: Conflict pre-check — find names that already exist
        const conflictResult = await query<{ name: string }>(
            `SELECT name FROM ${SCHEMA}.vault_variables
             WHERE project_id = $1 AND environment_id = $2 AND name = ANY($3::text[])`,
            [projectId, environmentId, incomingNames]
        );
        const conflictingNames = conflictResult.rows.map((r) => r.name);

        if (conflictingNames.length > 0 && !overwrite) {
            return NextResponse.json(
                {
                    error: 'Some variables already exist. Confirm overwrite to proceed.',
                    conflicts: conflictingNames,
                },
                { status: 409 }
            );
        }

        // Check if net-new variables would exceed the limit
        const newNames = incomingNames.filter((n) => !conflictingNames.includes(n));
        if (currentCount + newNames.length > limits.maxVariables) {
            const remaining = Math.max(0, limits.maxVariables - currentCount);
            return NextResponse.json(
                {
                    error: `Only ${remaining} variable slot${remaining === 1 ? '' : 's'} remaining on your plan.`,
                },
                { status: 400 }
            );
        }

        // Step 2: Encrypt each variable and build multi-row upsert
        const dek = await getProjectDek(projectId);

        const params: unknown[] = [projectId, workspaceId, environmentId, user.id];
        const valueClauses: string[] = [];
        let idx = 5;

        for (const v of variables) {
            const { ciphertext, iv, authTag } = encryptValue(v.value, dek);
            valueClauses.push(`($1, $2, $3, $${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, 'aes-256-gcm', 1, $4, $4)`);
            params.push(v.name, ciphertext, iv, authTag);
            idx += 4;
        }

        await query(
            `INSERT INTO ${SCHEMA}.vault_variables
                (project_id, workspace_id, environment_id, name, ciphertext, iv, auth_tag, algorithm, key_version, created_by, updated_by)
             VALUES ${valueClauses.join(', ')}
             ON CONFLICT (project_id, environment_id, name)
             DO UPDATE SET
                ciphertext = EXCLUDED.ciphertext,
                iv = EXCLUDED.iv,
                auth_tag = EXCLUDED.auth_tag,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by`,
            params
        );

        const importedCount = newNames.length;
        const overwrittenCount = conflictingNames.length;

        // Audit — never log values
        query(
            `INSERT INTO ${SCHEMA}.vault_audit_log
                (project_id, workspace_id, actor_id, event_type, resource_type, environment_id, metadata)
             VALUES ($1, $2, $3, 'variables.imported', 'variable', $4, $5)`,
            [projectId, workspaceId, user.id, environmentId, JSON.stringify({
                environmentId,
                environmentName,
                importedCount,
                overwrittenCount,
            })]
        ).catch((err) => console.error('[vault audit]', err));

        return NextResponse.json({ data: { importedCount, overwrittenCount } }, { status: 201 });
    } catch (e: unknown) {
        console.error('[vault/import]', e);
        return vaultRouteErrorResponse(e);
    }
}
