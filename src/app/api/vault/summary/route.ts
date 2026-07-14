import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { requireVaultApiUser } from '@/lib/vault/mfa-route';
import { vaultRouteErrorResponse } from '@/lib/vault/handle-vault-route-error';
import { requireVaultMember, getVaultLimits, canSeeProtectedEnv } from '@/lib/vault/auth';
import { ensureProjectVaultInitialized } from '@/lib/vault/keys';
import { vaultApiErrorFromUnknown } from '@/lib/vault/api-errors';
import { query, SCHEMA } from '@/lib/db';
import type { VaultEnvironmentWithCount, VaultSummary } from '@/types/vault';

const querySchema = z.object({
    projectId: z.string().uuid(),
});

export async function GET(request: Request) {
    try {
        const user = await requireVaultApiUser(request);

        const { searchParams } = new URL(request.url);
        const parsed = querySchema.safeParse({ projectId: searchParams.get('projectId') });
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
        }
        const { projectId } = parsed.data;

        const { isAdmin } = await requireVaultMember(projectId, user.id);
        const { limits, planCode, subscriptionPlanCode, subscriptionStatus } =
            await getVaultLimits(projectId);

        // Idempotent: creates DEK + seeds system environments on first open
        await ensureProjectVaultInitialized(projectId, user.id);

        const result = await query<VaultEnvironmentWithCount & { variable_count: string }>(
            `SELECT
                e.id, e.project_id, e.workspace_id, e.name, e.description, e.is_system,
                e.created_by, e.created_at, e.updated_at,
                COUNT(v.id)::int AS variable_count
             FROM ${SCHEMA}.vault_environments e
             LEFT JOIN ${SCHEMA}.vault_variables v ON v.environment_id = e.id
             WHERE e.project_id = $1
             GROUP BY e.id
             ORDER BY e.is_system DESC, e.name ASC`,
            [projectId]
        );

        const environments: VaultEnvironmentWithCount[] = result.rows
            .filter((r) => canSeeProtectedEnv(isAdmin, r.name))
            .map((r) => ({
                ...r,
                variable_count: Number(r.variable_count),
            }));

        const totalVariables = environments.reduce((sum, e) => sum + e.variable_count, 0);

        const summary: VaultSummary = {
            environments,
            totalVariables,
            limits,
            planCode,
            subscriptionPlanCode,
            subscriptionStatus,
            isAdmin,
            hasKey: true,
        };

        return NextResponse.json({ data: summary });
    } catch (e: unknown) {
        const vaultErr = vaultRouteErrorResponse(e);
        if (vaultErr) return vaultErr;
        if (e instanceof WorkspaceAccessError) {
            return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
        }
        console.error('[vault/summary]', e);
        const mapped = vaultApiErrorFromUnknown(e);
        return NextResponse.json(
            { error: mapped.error, code: mapped.code, detail: mapped.detail },
            { status: mapped.status }
        );
    }
}
