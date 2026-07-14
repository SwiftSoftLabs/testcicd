/**
 * GET /api/billing/summary?workspaceId=<uuid>
 * Returns the billing summary for a workspace: plan, subscription, entitlements, usage, canManage.
 * Auth: session cookie (sb-access-token). Caller must be a workspace member.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserFromRequest, query, SCHEMA } from '@/lib/db';
import { getWorkspaceSubscription, getWorkspaceEntitlements } from '@/lib/billing/subscription';
import { computeOverQuota } from '@/lib/billing/reconcile';
import { getCallMinutesUsed } from '@/lib/billing/callUsage';
import { getWorkspaceBillingPeriod } from '@/lib/billing/billingPeriod';
import { isBillingTester, PRE_LAUNCH_GATE } from '@/lib/billing/testers';
import { getKelviqApiCustomerId } from '@/lib/billing/kelviq-customer-refs';
import { listInvoices, listPaymentMethods } from '@/lib/integrations/kelviq/client';
import type { BillingPlan, BillingSummary, Invoice, PaymentMethod } from '@/types/billing';

const querySchema = z.object({
    workspaceId: z.string().uuid(),
});

export async function GET(request: Request) {
    const user = await getUserFromRequest(request);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({ workspaceId: searchParams.get('workspaceId') });
    if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid workspaceId' }, { status: 400 });
    }
    const { workspaceId } = parsed.data;

    try {
        const memberResult = await query<{ role: string }>(
            `SELECT wm.role
             FROM ${SCHEMA}.workspace_members wm
             WHERE wm.workspace_id = $1 AND wm.user_id = $2
             LIMIT 1`,
            [workspaceId, user.id],
        );

        if (!memberResult.rows[0]) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const role = memberResult.rows[0].role;
        const { plan, subscription } = await getWorkspaceSubscription(workspaceId);
        const billingPeriod = await getWorkspaceBillingPeriod(workspaceId);
        const [entitlements, overQuota, usageResult, plansResult, callMinutesUsed] = await Promise.all([
            getWorkspaceEntitlements(workspaceId, plan),
            computeOverQuota(workspaceId),
            query<{
                projects: number;
                seats: number;
                channels: number;
                mail_accounts: number;
                current_user_mail_accounts: number;
                storage_bytes: string;
            }>(
                `SELECT
                    (SELECT COUNT(*)::int FROM ${SCHEMA}.projects WHERE workspace_id = $1) AS projects,
                    (SELECT COUNT(*)::int FROM ${SCHEMA}.workspace_members WHERE workspace_id = $1) AS seats,
                    (SELECT COUNT(*)::int
                     FROM ${SCHEMA}.conversations
                     WHERE workspace_id = $1
                       AND type = 'channel'
                       AND archived_at IS NULL) AS channels,
                    (SELECT COUNT(*)::int FROM ${SCHEMA}.mail_accounts ma
                     JOIN ${SCHEMA}.workspace_members wm ON wm.user_id = ma.user_id
                     WHERE wm.workspace_id = $1
                       AND ma.status <> 'disconnected') AS mail_accounts,
                    (SELECT COUNT(*)::int
                     FROM ${SCHEMA}.mail_accounts
                     WHERE user_id = $2
                       AND status <> 'disconnected') AS current_user_mail_accounts,
                    (SELECT COALESCE(SUM(file_size), 0)::text
                     FROM ${SCHEMA}.workspace_files
                     WHERE workspace_id = $1) AS storage_bytes`,
                [workspaceId, user.id],
            ),
            query<BillingPlan>(
                `SELECT
                    code,
                    name,
                    price_cents,
                    currency,
                    interval,
                    kelviq_variant_id,
                    max_projects,
                    max_seats,
                    max_channels,
                    max_inboxes_per_user,
                    max_storage_bytes,
                    max_call_minutes_monthly,
                    max_call_duration_minutes,
                    analytics_level,
                    ai_tier,
                    support_tier,
                    contact_sales,
                    is_active,
                    sort_order
                 FROM ${SCHEMA}.billing_plans
                 WHERE is_active = true
                 ORDER BY sort_order ASC, name ASC`,
            ),
            getCallMinutesUsed(
                workspaceId,
                billingPeriod.start,
                billingPeriod.end,
            ),
        ]);

        const usageRow = usageResult.rows[0];
        const usage = {
            projects: usageRow?.projects ?? 0,
            seats: usageRow?.seats ?? 0,
            channels: usageRow?.channels ?? 0,
            mail_accounts: usageRow?.mail_accounts ?? 0,
            current_user_mail_accounts: usageRow?.current_user_mail_accounts ?? 0,
            storage_bytes: parseInt(usageRow?.storage_bytes ?? '0', 10),
            call_minutes_used: callMinutesUsed,
        };

        const isOwnerOrAdmin = role === 'owner' || role === 'admin';
        const canManage = isOwnerOrAdmin && (PRE_LAUNCH_GATE ? isBillingTester(user.email) : true);

        // Fetch real invoices and payment methods for owner/admins on paid plans
        let paymentMethods: PaymentMethod[] = [];
        let invoices: Invoice[] = [];
        if (isOwnerOrAdmin && subscription.kelviq_subscription_id) {
            const customerResult = await query<{
                kelviq_customer_id: string | null;
                kelviq_customer_internal_id: string | null;
            }>(
                `SELECT kelviq_customer_id, kelviq_customer_internal_id
                 FROM ${SCHEMA}.billing_customers WHERE workspace_id = $1 LIMIT 1`,
                [workspaceId],
            );
            const customerRow = customerResult.rows[0];
            if (customerRow?.kelviq_customer_id || customerRow?.kelviq_customer_internal_id) {
                const kelviqApiCustomerId = getKelviqApiCustomerId({
                    workspace_id: workspaceId,
                    kelviq_customer_id: customerRow.kelviq_customer_id,
                    kelviq_customer_internal_id: customerRow.kelviq_customer_internal_id,
                });
                const [rawInvoices, rawPaymentMethods] = await Promise.allSettled([
                    listInvoices(kelviqApiCustomerId),
                    listPaymentMethods(kelviqApiCustomerId),
                ]);
                if (rawInvoices.status === 'fulfilled') {
                    invoices = rawInvoices.value.map(inv => ({
                        id: inv.id,
                        workspace_id: workspaceId,
                        kelviq_invoice_id: inv.id,
                        number: inv.number ?? null,
                        amount_cents: inv.amountCents,
                        currency: inv.currency,
                        status: inv.status,
                        hosted_url: inv.hostedUrl ?? null,
                        issued_at: inv.issuedAt ?? null,
                    }));
                }
                if (rawPaymentMethods.status === 'fulfilled') {
                    paymentMethods = rawPaymentMethods.value.map(pm => ({
                        id: pm.id,
                        workspace_id: workspaceId,
                        kelviq_pm_id: pm.id,
                        brand: pm.brand,
                        last4: pm.last4,
                        exp_month: pm.expMonth,
                        exp_year: pm.expYear,
                        is_default: pm.isDefault,
                    }));
                }
            }
        }

        const summary: BillingSummary = {
            plans: plansResult.rows,
            plan,
            subscription,
            entitlements,
            usage,
            overQuota,
            paymentMethods,
            invoices,
            canManage,
            isOwnerOrAdmin,
        };

        return NextResponse.json({ data: summary });
    } catch (error: unknown) {
        console.error('Error fetching billing summary:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
