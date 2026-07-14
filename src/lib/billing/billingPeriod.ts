import { query, SCHEMA } from '@/lib/db';

export interface BillingPeriod {
    start: Date;
    end: Date;
}

/** Resolve the usage window for metered entitlements (call minutes). */
export async function getWorkspaceBillingPeriod(
    workspaceId: string,
): Promise<BillingPeriod> {
    const result = await query<{
        status: string;
        current_period_end: string | null;
        created_at: string;
    }>(
        `SELECT status, current_period_end, created_at
         FROM ${SCHEMA}.workspace_subscriptions
         WHERE workspace_id = $1 AND status <> 'canceled'
         ORDER BY created_at DESC
         LIMIT 1`,
        [workspaceId],
    );

    const row = result.rows[0];
    const now = new Date();

    if (
        row &&
        row.current_period_end &&
        (row.status === 'active' ||
            row.status === 'past_due' ||
            row.status === 'trialing' ||
            row.status === 'manual')
    ) {
        const end = new Date(row.current_period_end);
        const start = new Date(end);
        start.setUTCMonth(start.getUTCMonth() - 1);
        return { start, end };
    }

    const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    return { start, end };
}
