/**
 * POST /api/billing/portal
 * Mints a Kelviq Customer Portal session URL for a workspace.
 * Kelviq's portal is where users view invoices, manage payment methods,
 * and see subscription history. We don't expose that data ourselves.
 * Body: { workspaceId: string }
 * Returns: { url: string }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserFromRequest, query, SCHEMA } from '@/lib/db';
import { PRE_LAUNCH_GATE, isBillingTester } from '@/lib/billing/testers';
import {
    getKelviqApiCustomerId,
    type BillingCustomerKelviqRefs,
} from '@/lib/billing/kelviq-customer-refs';
import { getPortalUrl } from '@/lib/integrations/kelviq/client';

const bodySchema = z.object({
    workspaceId: z.string().uuid(),
});

export async function POST(request: Request) {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (PRE_LAUNCH_GATE && !isBillingTester(user.email ?? '')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { workspaceId } = parsed.data;

    try {
        const memberResult = await query<{ role: string }>(
            `SELECT wm.role FROM ${SCHEMA}.workspace_members wm
             WHERE wm.workspace_id = $1 AND wm.user_id = $2 LIMIT 1`,
            [workspaceId, user.id],
        );
        const role = memberResult.rows[0]?.role;
        if (!role || (role !== 'owner' && role !== 'admin')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const custResult = await query<{
            kelviq_customer_id: string | null;
            kelviq_customer_internal_id: string | null;
        }>(
            `SELECT kelviq_customer_id, kelviq_customer_internal_id
             FROM ${SCHEMA}.billing_customers WHERE workspace_id = $1 LIMIT 1`,
            [workspaceId],
        );
        const row = custResult.rows[0];
        if (!row?.kelviq_customer_id && !row?.kelviq_customer_internal_id) {
            return NextResponse.json({ error: 'No billing record yet. Subscribe to a paid plan first.' }, { status: 400 });
        }

        const refs: BillingCustomerKelviqRefs = {
            workspace_id: workspaceId,
            kelviq_customer_id: row.kelviq_customer_id,
            kelviq_customer_internal_id: row.kelviq_customer_internal_id,
        };
        const url = await getPortalUrl(getKelviqApiCustomerId(refs));
        if (!url) {
            return NextResponse.json({ error: 'Could not generate portal session' }, { status: 502 });
        }

        return NextResponse.json({ url });
    } catch (err) {
        console.error('[portal] Unexpected error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
