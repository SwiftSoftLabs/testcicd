import { query, SCHEMA } from '@/lib/db';
import {
    getKelviqApiCustomerId,
    isExternalKelviqCustomerRef,
    reconcileKelviqCustomerRefsFromKelviq,
} from '@/lib/billing/kelviq-customer-refs';
import { getCustomerSubscriptions } from '@/lib/integrations/kelviq/client';
import { evaluateQuotaGrace } from '@/lib/billing/reconcile';
import { maybeRevokeCliTokensOnBillingChange } from '@/lib/vault/cli-token-lifecycle';
import type { PlanCode } from '@/types/billing';

const PLAN_CODE_MAP: Record<string, PlanCode> = { pro: 'pro', max: 'max' };

export type SyncKelviqSkipReason =
    | 'no_billing_customer'
    | 'no_live_subscription'
    | 'unknown_plan'
    | 'deferred_cancel_pending'
    | 'already_current';

export type SyncKelviqResult =
    | { synced: true; planCode: PlanCode; status: string }
    | { synced: false; reason: SyncKelviqSkipReason };

interface WorkspaceBillingRow {
    kelviq_customer_id: string | null;
    kelviq_customer_internal_id: string | null;
    sub_plan_code: string | null;
    sub_status: string | null;
    sub_cancel_at_period_end: boolean | null;
    sub_current_period_end: string | null;
    sub_kelviq_object_updated_at: string | null;
}

function mapKelviqStatus(status: string): 'active' | 'trialing' | 'past_due' {
    if (status === 'trialing') return 'trialing';
    if (status === 'past_due') return 'past_due';
    return 'active';
}

/**
 * Pull the live Kelviq subscription for a workspace and upsert workspace_subscriptions.
 * Used after checkout and by the reconcile job when webhooks are delayed or missed.
 */
export async function syncKelviqSubscriptionForWorkspace(
    workspaceId: string,
): Promise<SyncKelviqResult> {
    const result = await query<WorkspaceBillingRow>(
        `SELECT
             bc.kelviq_customer_id,
             bc.kelviq_customer_internal_id,
             ws.plan_code      AS sub_plan_code,
             ws.status         AS sub_status,
             ws.cancel_at_period_end   AS sub_cancel_at_period_end,
             ws.current_period_end     AS sub_current_period_end,
             ws.kelviq_object_updated_at AS sub_kelviq_object_updated_at
         FROM ${SCHEMA}.billing_customers bc
         LEFT JOIN ${SCHEMA}.workspace_subscriptions ws
           ON ws.workspace_id = bc.workspace_id AND ws.status NOT IN ('basic', 'canceled')
         WHERE bc.workspace_id = $1
         LIMIT 1`,
        [workspaceId],
    );

    let row = result.rows[0];
    if (!row?.kelviq_customer_id && !row?.kelviq_customer_internal_id) {
        return { synced: false, reason: 'no_billing_customer' };
    }

    const needsKelviqReconcile =
        !row.kelviq_customer_internal_id
        || !isExternalKelviqCustomerRef(row.kelviq_customer_id, workspaceId);

    if (needsKelviqReconcile) {
        const reconciled = await reconcileKelviqCustomerRefsFromKelviq(workspaceId);
        if (reconciled?.kelviq_customer_internal_id) {
            row = {
                ...row,
                kelviq_customer_id: reconciled.kelviq_customer_id,
                kelviq_customer_internal_id: reconciled.kelviq_customer_internal_id,
            };
        }
    }

    const kelviqApiCustomerId = getKelviqApiCustomerId({
        workspace_id: workspaceId,
        kelviq_customer_id: row.kelviq_customer_id,
        kelviq_customer_internal_id: row.kelviq_customer_internal_id,
    });

    let kelviqSubs = await getCustomerSubscriptions(kelviqApiCustomerId);
    // Kelviq list filters are inconsistent — retry with external workspace UUID when empty.
    if (
        kelviqSubs.length === 0
        && row.kelviq_customer_id
        && row.kelviq_customer_id !== kelviqApiCustomerId
    ) {
        kelviqSubs = await getCustomerSubscriptions(row.kelviq_customer_id);
    }
    const liveSub = kelviqSubs.find((s) => s.status !== 'canceled');
    if (!liveSub) {
        return { synced: false, reason: 'no_live_subscription' };
    }

    const localPeriodEnd = row.sub_current_period_end;
    if (
        row.sub_cancel_at_period_end === true
        && localPeriodEnd
        && new Date(localPeriodEnd).getTime() > Date.now()
    ) {
        return { synced: false, reason: 'deferred_cancel_pending' };
    }

    const planCode = PLAN_CODE_MAP[liveSub.planIdentifier] ?? null;
    if (!planCode) {
        return { synced: false, reason: 'unknown_plan' };
    }

    const kelviqUpdatedAt = liveSub.updatedAt ?? new Date().toISOString();
    const localUpdatedAt = row.sub_kelviq_object_updated_at;
    if (localUpdatedAt && localUpdatedAt >= kelviqUpdatedAt) {
        return { synced: false, reason: 'already_current' };
    }

    const kelviqStatus = mapKelviqStatus(liveSub.status);

    await query(
        `INSERT INTO ${SCHEMA}.workspace_subscriptions
             (workspace_id, plan_code, status, kelviq_subscription_id, unit_price_cents, currency,
              current_period_end, cancel_at_period_end, kelviq_object_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (workspace_id) WHERE status <> 'canceled'
         DO UPDATE SET
             plan_code               = EXCLUDED.plan_code,
             status                  = EXCLUDED.status,
             kelviq_subscription_id  = EXCLUDED.kelviq_subscription_id,
             unit_price_cents        = COALESCE(EXCLUDED.unit_price_cents, workspace_subscriptions.unit_price_cents),
             currency                = COALESCE(EXCLUDED.currency, workspace_subscriptions.currency),
             current_period_end      = COALESCE(EXCLUDED.current_period_end, workspace_subscriptions.current_period_end),
             cancel_at_period_end    = EXCLUDED.cancel_at_period_end,
             kelviq_object_updated_at = EXCLUDED.kelviq_object_updated_at,
             updated_at              = NOW()
         WHERE workspace_subscriptions.kelviq_object_updated_at IS NULL
            OR workspace_subscriptions.kelviq_object_updated_at < EXCLUDED.kelviq_object_updated_at`,
        [
            workspaceId,
            planCode,
            kelviqStatus,
            liveSub.id,
            liveSub.unitPriceCents ?? null,
            liveSub.currency ?? 'usd',
            liveSub.currentPeriodEnd || null,
            liveSub.cancelAtPeriodEnd ?? false,
            kelviqUpdatedAt,
        ],
    );

    await query(
        `INSERT INTO ${SCHEMA}.billing_events (kelviq_event_id, event_type, workspace_id, payload)
         VALUES ($1, 'checkout.verify_sync', $2, $3)
         ON CONFLICT (kelviq_event_id) DO NOTHING`,
        [
            `verify-sync-${workspaceId}-${kelviqUpdatedAt}`,
            workspaceId,
            JSON.stringify({ planCode, status: kelviqStatus, kelviqSubId: liveSub.id }),
        ],
    );

    await maybeRevokeCliTokensOnBillingChange(
        workspaceId,
        row.sub_plan_code as PlanCode | null,
        row.sub_status,
        planCode,
        kelviqStatus,
    );

    await evaluateQuotaGrace(workspaceId);

    return { synced: true, planCode, status: kelviqStatus };
}
