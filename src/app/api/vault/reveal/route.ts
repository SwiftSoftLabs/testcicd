import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireVaultApiUser } from '@/lib/vault/mfa-route';
import { requireVaultMember, assertEnvWritable } from '@/lib/vault/auth';
import { vaultRouteErrorResponse } from '@/lib/vault/handle-vault-route-error';
import { getProjectDek } from '@/lib/vault/keys';
import { decryptValue } from '@/lib/vault/crypto';
import { query, SCHEMA } from '@/lib/db';
import type { VaultVariableRow, VaultRevealResult } from '@/types/vault';

const bodySchema = z.object({
    projectId: z.string().uuid(),
    variableId: z.string().uuid(),
});

export async function POST(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
        }
        const { projectId, variableId } = parsed.data;

        // Run auth check and variable fetch in parallel
        const [{ workspaceId, isAdmin }, varResult] = await Promise.all([
            requireVaultMember(projectId, user.id),
            query<VaultVariableRow & { env_name: string }>(
                `SELECT v.id, v.project_id, v.workspace_id, v.environment_id, v.name,
                        v.ciphertext, v.iv, v.auth_tag, v.algorithm, v.key_version,
                        v.created_by, v.updated_by, v.created_at, v.updated_at,
                        e.name AS env_name
                 FROM ${SCHEMA}.vault_variables v
                 JOIN ${SCHEMA}.vault_environments e ON e.id = v.environment_id
                 WHERE v.id = $1 AND v.project_id = $2
                 LIMIT 1`,
                [variableId, projectId]
            ),
        ]);

        if (varResult.rowCount === 0) {
            return NextResponse.json({ error: 'Variable not found' }, { status: 404 });
        }

        const row = varResult.rows[0];

        // Reveal is a read with secrets — enforce the same production boundary as writes
        assertEnvWritable(isAdmin, row.env_name);
        const dek = await getProjectDek(projectId);
        const plaintext = decryptValue(
            { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag },
            dek
        );

        // Fire-and-forget audit write — does not block the response
        query(
            `INSERT INTO ${SCHEMA}.vault_audit_log
                (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, environment_id, metadata)
             VALUES ($1, $2, $3, 'variable.revealed', 'variable', $4, $5, $6)`,
            [projectId, workspaceId, user.id, row.id, row.environment_id, JSON.stringify({
                variableName: row.name,
                environmentId: row.environment_id,
            })]
        ).catch(err => console.error('[vault/reveal audit]', err));

        const result: VaultRevealResult = {
            variableId: row.id,
            name: row.name,
            value: plaintext,
        };

        return NextResponse.json({ data: result });
    } catch (e: unknown) {
        console.error('[vault/reveal]', e);
        return vaultRouteErrorResponse(e);
    }
}
