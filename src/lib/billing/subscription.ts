import { query, SCHEMA } from '@/lib/db';
import { applyQuotaLocksIfDue, evaluateQuotaGrace } from '@/lib/billing/reconcile';
import { maybeRevokeCliTokensOnBillingChange } from '@/lib/vault/cli-token-lifecycle';
import type { BillingPlan, Entitlements, PlanCode, WorkspaceSubscription } from '@/types/billing';

const BASIC_PLAN: BillingPlan = {
    code: 'basic',
    name: 'Basic',
    price_cents: 0,
    currency: 'usd',
    interval: 'month',
    kelviq_variant_id: null,
    max_projects: 3,
    max_seats: 3,
    max_channels: 5,
    max_inboxes_per_user: 1,
    max_storage_bytes: 10 * 1024 * 1024,
    max_call_minutes_monthly: 10,
    max_call_duration_minutes: 1,
    analytics_level: 'none',
    ai_tier: 'none',
    support_tier: 'community',
    contact_sales: false,
    is_active: true,
    sort_order: 1,
};

const BASIC_SUBSCRIPTION: Omit<WorkspaceSubscription, 'id' | 'workspace_id' | 'created_at' | 'updated_at'> = {
    plan_code: 'basic',
    kelviq_subscription_id: null,
    status: 'basic',
    unit_price_cents: 0,
    currency: 'usd',
    current_period_end: null,
    cancel_at_period_end: false,
    cancel_reason: null,
    trial_ends_at: null,
    kelviq_object_updated_at: null,
    quota_grace_until: null,
};

interface SubscriptionRow extends WorkspaceSubscription {
    plan_name: string;
    plan_price_cents: number | null;
    plan_currency: string;
    plan_interval: string;
    plan_kelviq_variant_id: string | null;
    plan_max_projects: number | null;
    plan_max_seats: number | null;
    plan_max_channels: number | null;
    plan_max_inboxes_per_user: number | null;
    plan_max_storage_bytes: number;
    plan_max_call_minutes_monthly: number | null;
    plan_max_call_duration_minutes: number | null;
    plan_analytics_level: string;
    plan_ai_tier: string;
    plan_support_tier: string;
    plan_contact_sales: boolean;
    plan_is_active: boolean;
    plan_sort_order: number;
}

function isPaidEntitlementStatus(status: WorkspaceSubscription['status']): boolean {
    // 'manual' = entitled outside the automated billing flow (e.g. enterprise
    // contracts provisioned by hand). Kelviq webhooks must never write it.
    return status === 'active' || status === 'past_due' || status === 'trialing' || status === 'manual';
}

function buildPlanFromRow(row: SubscriptionRow): BillingPlan {
    return {
        code: row.plan_code as PlanCode,
        name: row.plan_name,
        price_cents: row.plan_price_cents,
        currency: row.plan_currency,
        interval: row.plan_interval as BillingPlan['interval'],
        kelviq_variant_id: row.plan_kelviq_variant_id,
        max_projects: row.plan_max_projects,
        max_seats: row.plan_max_seats,
        max_channels: row.plan_max_channels,
        max_inboxes_per_user: row.plan_max_inboxes_per_user,
        max_storage_bytes: row.plan_max_storage_bytes,
        max_call_minutes_monthly: row.plan_max_call_minutes_monthly,
        max_call_duration_minutes: row.plan_max_call_duration_minutes,
        analytics_level: row.plan_analytics_level as BillingPlan['analytics_level'],
        ai_tier: row.plan_ai_tier as BillingPlan['ai_tier'],
        support_tier: row.plan_support_tier as BillingPlan['support_tier'],
        contact_sales: row.plan_contact_sales,
        is_active: row.plan_is_active,
        sort_order: row.plan_sort_order,
    };
}

// Lazy expiry for deferred cancels. If a row is sitting in 'active' with
// cancel_at_period_end=true and the period has already elapsed, flip it to
// 'canceled' here so subsequent reads return the correct entitlements.
// This is the no-cron version of the cancel-at-period-end pattern — see
// docs/billing-deferred-work.md §1. Returns true when a row was flipped, so the
// caller can kick off quota grace for the now-Basic workspace.
async function expireDeferredCancels(workspaceId: string): Promise<boolean> {
    const result = await query<{ id: string; plan_code: PlanCode }>(
        `UPDATE ${SCHEMA}.workspace_subscriptions
         SET status = 'canceled', updated_at = NOW()
         WHERE workspace_id = $1
           AND status = 'active'
           AND cancel_at_period_end = true
           AND current_period_end IS NOT NULL
           AND current_period_end < NOW()
         RETURNING id, plan_code`,
        [workspaceId],
    );
    if (result.rows.length > 0) {
        const { plan_code: previousPlanCode } = result.rows[0];
        await maybeRevokeCliTokensOnBillingChange(
            workspaceId,
            previousPlanCode,
            'active',
            'basic',
            'canceled',
        );
    }
    return result.rows.length > 0;
}

export async function getWorkspaceSubscription(workspaceId: string): Promise<{
    plan: BillingPlan;
    subscription: WorkspaceSubscription;
}> {
    const flippedToCanceled = await expireDeferredCancels(workspaceId);
    // Intentional lazy-expiry fast path; if billing-read latency ever matters, batch
    // these follow-up queries into one SELECT-driven reconcile pass.
    // On the deferred-cancel→Basic transition there is no webhook, so start the
    // quota grace window here. Then lazily apply locks if a window has elapsed.
    if (flippedToCanceled) await evaluateQuotaGrace(workspaceId);
    await applyQuotaLocksIfDue(workspaceId);

    const result = await query<SubscriptionRow>(
        `SELECT
            s.id, s.workspace_id, s.plan_code, s.kelviq_subscription_id,
            s.status, s.unit_price_cents, s.currency, s.current_period_end,
            s.cancel_at_period_end, s.cancel_reason, s.trial_ends_at,
            s.kelviq_object_updated_at, s.quota_grace_until, s.created_at, s.updated_at,
            p.name           AS plan_name,
            p.price_cents    AS plan_price_cents,
            p.currency       AS plan_currency,
            p.interval       AS plan_interval,
            p.kelviq_variant_id AS plan_kelviq_variant_id,
            p.max_projects   AS plan_max_projects,
            p.max_seats      AS plan_max_seats,
            p.max_channels   AS plan_max_channels,
            p.max_inboxes_per_user AS plan_max_inboxes_per_user,
            p.max_storage_bytes AS plan_max_storage_bytes,
            p.max_call_minutes_monthly AS plan_max_call_minutes_monthly,
            p.max_call_duration_minutes AS plan_max_call_duration_minutes,
            p.analytics_level AS plan_analytics_level,
            p.ai_tier        AS plan_ai_tier,
            p.support_tier   AS plan_support_tier,
            p.contact_sales  AS plan_contact_sales,
            p.is_active      AS plan_is_active,
            p.sort_order     AS plan_sort_order
         FROM ${SCHEMA}.workspace_subscriptions s
         JOIN ${SCHEMA}.billing_plans p ON p.code = s.plan_code
         WHERE s.workspace_id = $1
           AND s.status <> 'canceled'
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [workspaceId],
    );

    if (result.rows.length === 0) {
        return {
            plan: BASIC_PLAN,
            subscription: {
                ...BASIC_SUBSCRIPTION,
                id: '',
                workspace_id: workspaceId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
        };
    }

    const row = result.rows[0];
    const paidPlan = buildPlanFromRow(row);

    const subscription: WorkspaceSubscription = {
        id: row.id,
        workspace_id: row.workspace_id,
        plan_code: row.plan_code,
        kelviq_subscription_id: row.kelviq_subscription_id,
        status: row.status,
        unit_price_cents: row.unit_price_cents,
        currency: row.currency,
        current_period_end: row.current_period_end,
        cancel_at_period_end: row.cancel_at_period_end,
        cancel_reason: row.cancel_reason,
        trial_ends_at: row.trial_ends_at,
        kelviq_object_updated_at: row.kelviq_object_updated_at,
        quota_grace_until: row.quota_grace_until,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };

    return {
        plan: isPaidEntitlementStatus(subscription.status) ? paidPlan : BASIC_PLAN,
        subscription,
    };
}

export async function getWorkspaceEntitlements(workspaceId: string, plan?: BillingPlan): Promise<Entitlements> {
    const resolvedPlan = plan ?? (await getWorkspaceSubscription(workspaceId)).plan;
    return {
        plan_code: resolvedPlan.code,
        max_projects: resolvedPlan.max_projects,
        max_seats: resolvedPlan.max_seats,
        max_channels: resolvedPlan.max_channels,
        max_inboxes_per_user: resolvedPlan.max_inboxes_per_user,
        max_storage_bytes: resolvedPlan.max_storage_bytes,
        max_call_minutes_monthly: resolvedPlan.max_call_minutes_monthly,
        max_call_duration_minutes: resolvedPlan.max_call_duration_minutes,
        analytics_level: resolvedPlan.analytics_level,
        ai_tier: resolvedPlan.ai_tier,
        support_tier: resolvedPlan.support_tier,
        contact_sales: resolvedPlan.contact_sales,
    };
}
