import type { PlanCode, SubscriptionStatus } from '@/types/billing';

const PAID_ENTITLEMENT_STATUSES: SubscriptionStatus[] = [
    'active',
    'past_due',
    'trialing',
    'manual',
];

/** Ordered vault billing tiers — higher rank includes all lower-tier features. */
export const VAULT_PLAN_RANK: Record<PlanCode, number> = {
    basic: 0,
    pro: 1,
    max: 2,
    enterprise: 3,
};

export type VaultMinPlan = 'pro' | 'max';

export function planAtLeast(planCode: string, minimum: VaultMinPlan): boolean {
    const rank = VAULT_PLAN_RANK[planCode as PlanCode];
    const minRank = VAULT_PLAN_RANK[minimum];
    if (rank === undefined || minRank === undefined) {
        return false;
    }
    return rank >= minRank;
}

export function vaultHasPro(planCode: string): boolean {
    return planAtLeast(planCode, 'pro');
}

export function vaultHasMax(planCode: string): boolean {
    return planAtLeast(planCode, 'max');
}

/** True when effective tier had Max+ before and no longer does after a billing change. */
export function shouldRevokeCliTokensAfterPlanChange(
    previousEffective: string,
    newEffective: string,
): boolean {
    return planAtLeast(previousEffective, 'max') && !planAtLeast(newEffective, 'max');
}

export function formatVaultPlanLabel(planCode: string): string {
    const labels: Record<PlanCode, string> = {
        basic: 'Basic',
        pro: 'Pro',
        max: 'Max',
        enterprise: 'Enterprise',
    };
    return labels[planCode as PlanCode] ?? planCode;
}

/**
 * True when the stored subscription tier is higher than effective vault entitlements
 * (e.g. plan_code enterprise but status not paid → effective basic).
 */
/** Effective vault tier from stored plan + subscription status (unpaid → basic). */
export function effectiveVaultPlanCode(
    planCode: PlanCode | string,
    status: SubscriptionStatus | string,
): PlanCode {
    if (PAID_ENTITLEMENT_STATUSES.includes(status as SubscriptionStatus)) {
        return planCode as PlanCode;
    }
    return 'basic';
}

export function vaultBillingPlanMismatch(
    subscriptionPlanCode: string,
    effectivePlanCode: string,
): boolean {
    const storedRank = VAULT_PLAN_RANK[subscriptionPlanCode as PlanCode];
    const effectiveRank = VAULT_PLAN_RANK[effectivePlanCode as PlanCode];
    if (storedRank === undefined || effectiveRank === undefined) {
        return false;
    }
    return storedRank > effectiveRank;
}
