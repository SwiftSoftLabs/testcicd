import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserFromRequest, query, SCHEMA } from '@/lib/db';
import { PRE_LAUNCH_GATE, isBillingTester } from '@/lib/billing/testers';
import { cancelSubscription } from '@/lib/integrations/kelviq/client';

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

        const subResult = await query<{
            id: string;
            kelviq_subscription_id: string | null;
            status: string;
            cancel_at_period_end: boolean;
        }>(
            `SELECT id, kelviq_subscription_id, status, cancel_at_period_end
             FROM ${SCHEMA}.workspace_subscriptions
             WHERE workspace_id = $1 AND status NOT IN ('basic', 'canceled')
             ORDER BY created_at DESC LIMIT 1`,
            [workspaceId],
        );

        const sub = subResult.rows[0];
        if (!sub) {
            return NextResponse.json({ error: 'No active subscription found' }, { status: 400 });
        }
        if (sub.status !== 'active' && sub.status !== 'past_due' && sub.status !== 'trialing') {
            return NextResponse.json({ error: 'Subscription is not in a cancellable state' }, { status: 400 });
        }
        if (sub.cancel_at_period_end) {
            return NextResponse.json({ error: 'Cancellation already scheduled' }, { status: 400 });
        }
        if (!sub.kelviq_subscription_id) {
            return NextResponse.json({ error: 'No Kelviq subscription linked' }, { status: 400 });
        }

        try {
            await cancelSubscription(sub.kelviq_subscription_id);
        } catch (err) {
            console.error('[cancel] Kelviq cancel failed:', err);
            return NextResponse.json({ error: 'Failed to cancel subscription with payment provider' }, { status: 502 });
        }

        // Deferred cancel: Kelviq's side is now in 'canceled' state (billing stopped),
        // but we keep status='active' locally so the user retains Pro entitlements
        // through current_period_end. lib/billing/subscription.ts flips status to
        // 'canceled' lazily once the period ends. See docs/billing-deferred-work.md.
        await query(
            `UPDATE ${SCHEMA}.workspace_subscriptions
             SET cancel_at_period_end = true, cancel_reason = 'voluntary', updated_at = NOW()
             WHERE id = $1`,
            [sub.id],
        );

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[cancel] Unexpected error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
