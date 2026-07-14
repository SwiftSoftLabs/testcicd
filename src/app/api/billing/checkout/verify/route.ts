/**
 * POST /api/billing/checkout/verify
 * After Kelviq hosted checkout, pull subscription state from Kelviq and sync local DB.
 * Fallback when subscription.created webhooks are delayed or missed.
 * Body: { workspaceId: string }
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserFromRequest, query, SCHEMA } from '@/lib/db';
import { syncKelviqSubscriptionForWorkspace } from '@/lib/billing/sync-kelviq-subscription';
import { isBillingTester, PRE_LAUNCH_GATE } from '@/lib/billing/testers';

const bodySchema = z.object({
    workspaceId: z.string().uuid(),
});

export async function POST(request: Request) {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    const { workspaceId } = parsed.data;

    const memberResult = await query<{ role: string }>(
        `SELECT wm.role FROM ${SCHEMA}.workspace_members wm
         WHERE wm.workspace_id = $1 AND wm.user_id = $2 LIMIT 1`,
        [workspaceId, user.id],
    );
    const role = memberResult.rows[0]?.role;
    if (!role || (role !== 'owner' && role !== 'admin')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (PRE_LAUNCH_GATE && !isBillingTester(user.email ?? '')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const result = await syncKelviqSubscriptionForWorkspace(workspaceId);
        return NextResponse.json({ data: result });
    } catch (error: unknown) {
        console.error('[checkout/verify] sync failed:', error);
        return NextResponse.json({ error: 'Failed to verify checkout' }, { status: 500 });
    }
}
