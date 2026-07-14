import { query, SCHEMA } from '@/lib/db';
import { getWorkspaceBillingPeriod } from '@/lib/billing/billingPeriod';

export async function getCallMinutesUsed(
    workspaceId: string,
    periodStart?: Date,
    periodEnd?: Date,
): Promise<number> {
    const period =
        periodStart && periodEnd
            ? { start: periodStart, end: periodEnd }
            : await getWorkspaceBillingPeriod(workspaceId);

    const result = await query<{ total: string }>(
        `SELECT COALESCE(SUM(
            CEIL(
                EXTRACT(EPOCH FROM (
                    COALESCE(ended_at, NOW()) - started_at
                )) / 60.0
            )
        ), 0)::text AS total
         FROM ${SCHEMA}.call_sessions
         WHERE workspace_id = $1
           AND started_at IS NOT NULL
           AND started_at >= $2
           AND started_at < $3
           AND status IN ('live', 'processing', 'completed')`,
        [workspaceId, period.start.toISOString(), period.end.toISOString()],
    );

    return parseInt(result.rows[0]?.total ?? '0', 10);
}
