/**
 * POST /api/billing/reconcile
 * Server-only reconciliation job: compares Kelviq subscription state with local workspace_subscriptions
 * and repairs divergence caused by missed webhooks.
 * Protected by BILLING_RECONCILE_SECRET — must be set in env.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { getKelviqApiCustomerId } from '@/lib/billing/kelviq-customer-refs';
import { getCustomerSubscriptions } from '@/lib/integrations/kelviq/client';
import type { PlanCode } from '@/types/billing';
import { maybeRevokeCliTokensOnBillingChange } from '@/lib/vault/cli-token-lifecycle';

const PLAN_CODE_MAP: Record<string, PlanCode> = { pro: 'pro', max: 'max' };

interface CustomerRow {
    workspace_id: string;
    kelviq_customer_id: string | null;
    kelviq_customer_internal_id: string | null;
    sub_id: string | null;
    sub_status: string | null;
    sub_plan_code: string | null;
    sub_kelviq_sub_id: string | null;
    sub_cancel_at_period_end: boolean | null;
    sub_current_period_end: string | null;
    sub_unit_price_cents: number | null;
    sub_currency: string | null;
    sub_kelviq_object_updated_at: string | null;
}

export async function POST(request: Request) {
    const secret = process.env.BILLING_RECONCILE_SECRET;
    if (!secret) {
        return NextResponse.json({ error: 'Reconciliation is not configured' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization') ?? '';
    if (authHeader !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let customers;
    try {
        customers = await query<CustomerRow>(
            `SELECT
                 bc.workspace_id,
                 bc.kelviq_customer_id,
                 bc.kelviq_customer_internal_id,
                 ws.id             AS sub_id,
                 ws.status         AS sub_status,
                 ws.plan_code      AS sub_plan_code,
                 ws.kelviq_subscription_id AS sub_kelviq_sub_id,
                 ws.cancel_at_period_end   AS sub_cancel_at_period_end,
                 ws.current_period_end     AS sub_current_period_end,
                 ws.unit_price_cents       AS sub_unit_price_cents,
                 ws.currency               AS sub_currency,
                 ws.kelviq_object_updated_at AS sub_kelviq_object_updated_at
             FROM ${SCHEMA}.billing_customers bc
             LEFT JOIN ${SCHEMA}.workspace_subscriptions ws
               ON ws.workspace_id = bc.workspace_id AND ws.status NOT IN ('basic', 'canceled')
             WHERE bc.kelviq_customer_id IS NOT NULL
                OR bc.kelviq_customer_internal_id IS NOT NULL`,
        );
    } catch (err) {
        console.error('[reconcile] Failed to fetch billing customers:', err);
        return NextResponse.json({ error: 'Failed to fetch billing customers' }, { status: 500 });
    }

    const repaired: string[] = [];
    const errors: string[] = [];

    for (const row of customers.rows) {
        try {
            const kelviqApiCustomerId = getKelviqApiCustomerId({
                workspace_id: row.workspace_id,
                kelviq_customer_id: row.kelviq_customer_id,
                kelviq_customer_internal_id: row.kelviq_customer_internal_id,
            });
            const kelviqSubs = await getCustomerSubscriptions(kelviqApiCustomerId);
            // Only act on a live (non-canceled) Kelviq sub. If Kelviq shows only canceled
            // subs, that may be a real cancel OR our deferred-cancel pattern (Kelviq is
            // already 'canceled' but we're holding local at 'active' through current_period_end).
            // Either way, do not overwrite — lazy expiry in lib/billing/subscription.ts will
            // flip the local row to 'canceled' once the period elapses.
            const liveSub = kelviqSubs.find(s => s.status !== 'canceled');

            if (!liveSub) continue;

            // Defensive guard: if local has a deferred cancel pending, do not overwrite it
            // even if Kelviq returned a live sub for some reason (e.g. webhook race).
            const localPeriodEnd = row.sub_current_period_end;
            if (
                row.sub_cancel_at_period_end === true
                && localPeriodEnd
                && new Date(localPeriodEnd).getTime() > Date.now()
            ) {
                continue;
            }

            const planCode = PLAN_CODE_MAP[liveSub.planIdentifier] ?? null;
            if (!planCode) continue;

            const kelviqUpdatedAt = liveSub.updatedAt ?? new Date().toISOString();
            const localUpdatedAt = row.sub_kelviq_object_updated_at;

            // Skip if local state is already up-to-date
            if (localUpdatedAt && localUpdatedAt >= kelviqUpdatedAt) continue;

            const kelviqStatus = liveSub.status === 'trialing' ? 'trialing' : liveSub.status === 'past_due' ? 'past_due' : 'active';

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
                    row.workspace_id,
                    planCode,
                    kelviqStatus,
                    liveSub.id,
                    liveSub.unitPriceCents ?? null,
                    liveSub.currency ?? 'usd',
                    liveSub.currentPeriodEnd ?? null,
                    liveSub.cancelAtPeriodEnd ?? false,
                    kelviqUpdatedAt,
                ],
            );

            await query(
                `INSERT INTO ${SCHEMA}.billing_events (kelviq_event_id, event_type, workspace_id, payload)
                 VALUES ($1, 'reconciliation.repaired', $2, $3)
                 ON CONFLICT (kelviq_event_id) DO NOTHING`,
                [
                    `reconcile-${row.workspace_id}-${kelviqUpdatedAt}`,
                    row.workspace_id,
                    JSON.stringify({ planCode, status: kelviqStatus, kelviqSubId: liveSub.id }),
                ],
            );

            await maybeRevokeCliTokensOnBillingChange(
                row.workspace_id,
                row.sub_plan_code,
                row.sub_status,
                planCode,
                kelviqStatus,
            );

            repaired.push(row.workspace_id);
        } catch (err) {
            console.error(`[reconcile] Failed for workspace ${row.workspace_id}:`, err);
            errors.push(row.workspace_id);
        }
    }

    return NextResponse.json({
        total: customers.rows.length,
        repaired: repaired.length,
        errors: errors.length,
        repairedWorkspaces: repaired,
        errorWorkspaces: errors,
    });
}
