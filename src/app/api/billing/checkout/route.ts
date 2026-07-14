/**
 * POST /api/billing/checkout
 * Starts a Kelviq hosted checkout session for a workspace upgrade.
 * Body: { workspaceId: string, planCode: 'pro' | 'max' }
 * Returns: { checkoutUrl: string }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserFromRequest, query, SCHEMA } from '@/lib/db';
import { getKelviqConfig } from '@/lib/integrations/kelviq/config';
import { buildKelviqCustomerEmail } from '@/lib/billing/kelviq-customer-email';
import {
    ensureBillingCustomerKelviqRefs,
    ensureBillingCustomerExternalRef,
    getKelviqExternalCustomerId,
    isExternalKelviqCustomerRef,
    type BillingCustomerKelviqRefs,
} from '@/lib/billing/kelviq-customer-refs';
import {
    createOrGetCustomer,
    createCheckout,
    fetchCustomerByWorkspaceId,
} from '@/lib/integrations/kelviq/client';
import { isBillingTester, PRE_LAUNCH_GATE } from '@/lib/billing/testers';

const bodySchema = z.object({
    workspaceId: z.string().uuid(),
    planCode: z.enum(['pro', 'max']),
});

async function loadOrCreateKelviqRefs(
    workspaceId: string,
    userEmail: string,
    workspaceName: string,
): Promise<BillingCustomerKelviqRefs> {
    const custResult = await query<{
        kelviq_customer_id: string | null;
        kelviq_customer_internal_id: string | null;
    }>(
        `SELECT kelviq_customer_id, kelviq_customer_internal_id
         FROM ${SCHEMA}.billing_customers WHERE workspace_id = $1 LIMIT 1`,
        [workspaceId],
    );

    const existing = custResult.rows[0];
    if (existing?.kelviq_customer_id || existing?.kelviq_customer_internal_id) {
        let refs: BillingCustomerKelviqRefs = {
            workspace_id: workspaceId,
            kelviq_customer_id: existing.kelviq_customer_id,
            kelviq_customer_internal_id: existing.kelviq_customer_internal_id,
        };

        const needsKelviqSync =
            !refs.kelviq_customer_internal_id
            || !isExternalKelviqCustomerRef(refs.kelviq_customer_id, workspaceId);

        if (needsKelviqSync) {
            const kelviqCustomer = await fetchCustomerByWorkspaceId(workspaceId);
            if (kelviqCustomer?.id) {
                await query(
                    `UPDATE ${SCHEMA}.billing_customers
                     SET kelviq_customer_id = $2,
                         kelviq_customer_internal_id = $3,
                         updated_at = NOW()
                     WHERE workspace_id = $1`,
                    [workspaceId, workspaceId, kelviqCustomer.id],
                );
                refs = {
                    workspace_id: workspaceId,
                    kelviq_customer_id: workspaceId,
                    kelviq_customer_internal_id: kelviqCustomer.id,
                };
            }
        }

        return refs;
    }

    // Per-workspace Kelviq customer (scoped email). Hosted checkout may still bill a shared
    // login-email customer — webhooks use resolvePendingCheckoutWorkspace as fallback.
    const kelviqEmail = buildKelviqCustomerEmail(userEmail, workspaceId);
    const customer = await createOrGetCustomer(workspaceId, kelviqEmail, workspaceName);
    await ensureBillingCustomerKelviqRefs(workspaceId, customer.id);
    await query(
        `UPDATE ${SCHEMA}.billing_customers
         SET billing_email = $2, updated_at = NOW()
         WHERE workspace_id = $1`,
        [workspaceId, userEmail],
    );

    return {
        workspace_id: workspaceId,
        kelviq_customer_id: workspaceId,
        kelviq_customer_internal_id: customer.id,
    };
}

export async function POST(request: Request) {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    const { workspaceId, planCode } = parsed.data;

    const memberResult = await query<{ role: string }>(
        `SELECT wm.role FROM ${SCHEMA}.workspace_members wm
         WHERE wm.workspace_id = $1 AND wm.user_id = $2 LIMIT 1`,
        [workspaceId, user.id],
    );
    const role = memberResult.rows[0]?.role;
    if (!role || (role !== 'owner' && role !== 'admin')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (PRE_LAUNCH_GATE && !isBillingTester(user.email)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const config = getKelviqConfig();
        const planIdentifier = config.planIdentifiers[planCode];

        const wsResult = await query<{ name: string }>(
            `SELECT name FROM ${SCHEMA}.workspaces WHERE id = $1 LIMIT 1`,
            [workspaceId],
        );
        const workspaceName = wsResult.rows[0]?.name ?? 'Workspace';

        const refs = await loadOrCreateKelviqRefs(
            workspaceId,
            user.email ?? '',
            workspaceName,
        );
        // Mark this workspace as the most recent checkout so shared Kelviq customers
        // (same login email across workspaces) resolve to the right workspace in webhooks.
        await query(
            `UPDATE ${SCHEMA}.billing_customers SET updated_at = NOW() WHERE workspace_id = $1`,
            [workspaceId],
        );
        const kelviqCheckoutCustomerId = getKelviqExternalCustomerId(refs);

        const origin = new URL(request.url).origin;
        const successUrl = `${origin}/settings/billing?checkout=success&workspaceId=${workspaceId}`;
        const cancelUrl = `${origin}/settings/billing?checkout=cancel&workspaceId=${workspaceId}`;

        const session = await createCheckout({
            planIdentifier,
            chargePeriod: 'MONTHLY',
            kelviqCustomerId: kelviqCheckoutCustomerId,
            successUrl,
            cancelUrl,
        });

        return NextResponse.json({ checkoutUrl: session.checkoutUrl });
    } catch (error: unknown) {
        console.error('Checkout error:', error);
        return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
    }
}
