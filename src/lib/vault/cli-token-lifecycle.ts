import { query, SCHEMA } from '@/lib/db';
import type { PlanCode, SubscriptionStatus } from '@/types/billing';
import {
    effectiveVaultPlanCode,
    shouldRevokeCliTokensAfterPlanChange,
} from '@/lib/vault/plan-tier';

export async function revokeVaultCliTokensOnPlanDowngrade(
    workspaceId: string,
    reason = 'plan_downgrade',
): Promise<number> {
    const result = await query<{ id: string; project_id: string; user_id: string }>(
        `UPDATE ${SCHEMA}.vault_cli_tokens
         SET revoked_at = NOW()
         WHERE workspace_id = $1 AND revoked_at IS NULL
         RETURNING id, project_id, user_id`,
        [workspaceId],
    );

    for (const row of result.rows) {
        await query(
            `INSERT INTO ${SCHEMA}.vault_audit_log
                (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, metadata)
             VALUES ($1, $2, $3, 'cli_token.revoked', 'cli_token', $4, $5)`,
            [
                row.project_id,
                workspaceId,
                row.user_id,
                row.id,
                JSON.stringify({ reason }),
            ],
        ).catch((err) => console.error('[vault audit cli_token.revoked]', err));
    }

    return result.rows.length;
}

export async function maybeRevokeCliTokensOnBillingChange(
    workspaceId: string,
    previousPlanCode: string | null | undefined,
    previousStatus: string | null | undefined,
    newPlanCode: string,
    newStatus: string,
): Promise<void> {
    const prevEffective = effectiveVaultPlanCode(
        (previousPlanCode ?? 'basic') as PlanCode,
        (previousStatus ?? 'basic') as SubscriptionStatus,
    );
    const newEffective = effectiveVaultPlanCode(
        newPlanCode as PlanCode,
        newStatus as SubscriptionStatus,
    );
    if (!shouldRevokeCliTokensAfterPlanChange(prevEffective, newEffective)) {
        return;
    }
    await revokeVaultCliTokensOnPlanDowngrade(workspaceId, 'plan_downgrade');
}

export async function revokeVaultCliTokensForUserInWorkspace(
    workspaceId: string,
    userId: string,
    reason = 'member_removed',
): Promise<number> {
    const result = await query<{ id: string; project_id: string }>(
        `UPDATE ${SCHEMA}.vault_cli_tokens
         SET revoked_at = NOW()
         WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL
         RETURNING id, project_id`,
        [workspaceId, userId],
    );

    for (const row of result.rows) {
        await query(
            `INSERT INTO ${SCHEMA}.vault_audit_log
                (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, metadata)
             VALUES ($1, $2, $3, 'cli_token.revoked', 'cli_token', $4, $5)`,
            [
                row.project_id,
                workspaceId,
                userId,
                row.id,
                JSON.stringify({ reason }),
            ],
        ).catch((err) => console.error('[vault audit cli_token.revoked]', err));
    }

    return result.rows.length;
}
