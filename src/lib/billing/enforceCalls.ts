import { getWorkspaceEntitlements } from '@/lib/billing/subscription';
import { getCallMinutesUsed } from '@/lib/billing/callUsage';
import { getWorkspaceBillingPeriod } from '@/lib/billing/billingPeriod';

export interface CallLimitResult {
    allowed: boolean;
    error?: string;
    code?: 'BILLING_CALL_LIMIT_REACHED';
    limit?: number | null;
    used?: number;
    planCode?: string;
}

export async function checkCallDurationLimit(
    workspaceId: string,
    scheduledMinutes: number | null | undefined,
): Promise<CallLimitResult> {
    if (scheduledMinutes == null || scheduledMinutes <= 0) {
        return { allowed: true };
    }

    const entitlements = await getWorkspaceEntitlements(workspaceId);
    const maxDuration = entitlements.max_call_duration_minutes;
    if (maxDuration === null) return { allowed: true };

    if (scheduledMinutes > maxDuration) {
        return {
            allowed: false,
            error: `Your ${entitlements.plan_code} plan allows meetings up to ${maxDuration} minutes. Shorten the meeting or upgrade your plan.`,
            code: 'BILLING_CALL_LIMIT_REACHED',
            limit: maxDuration,
            planCode: entitlements.plan_code,
        };
    }

    return { allowed: true };
}

export async function checkCallMinutesAvailable(
    workspaceId: string,
    estimatedMinutes = 1,
): Promise<CallLimitResult> {
    const entitlements = await getWorkspaceEntitlements(workspaceId);
    const monthlyCap = entitlements.max_call_minutes_monthly;
    if (monthlyCap === null) return { allowed: true };

    const period = await getWorkspaceBillingPeriod(workspaceId);
    const used = await getCallMinutesUsed(
        workspaceId,
        period.start,
        period.end,
    );

    if (used + estimatedMinutes > monthlyCap) {
        return {
            allowed: false,
            error: `Your ${entitlements.plan_code} plan includes ${monthlyCap.toLocaleString()} call minutes per billing period (${used.toLocaleString()} used). Upgrade for more meeting time.`,
            code: 'BILLING_CALL_LIMIT_REACHED',
            limit: monthlyCap,
            used,
            planCode: entitlements.plan_code,
        };
    }

    return { allowed: true, used, limit: monthlyCap };
}

export async function assertCallWithinDurationLimit(
    workspaceId: string,
    startedAt: string,
): Promise<CallLimitResult> {
    const entitlements = await getWorkspaceEntitlements(workspaceId);
    const maxDuration = entitlements.max_call_duration_minutes;
    if (maxDuration === null) return { allowed: true };

    const elapsedMinutes = Math.ceil(
        (Date.now() - new Date(startedAt).getTime()) / 60_000,
    );

    if (elapsedMinutes > maxDuration) {
        return {
            allowed: false,
            error: `This meeting has reached the ${maxDuration}-minute limit for your ${entitlements.plan_code} plan.`,
            code: 'BILLING_CALL_LIMIT_REACHED',
            limit: maxDuration,
            planCode: entitlements.plan_code,
        };
    }

    return { allowed: true };
}
