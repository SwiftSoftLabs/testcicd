import { requireWorkspaceMember, isWorkspaceAdmin, WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { getProjectWorkspaceId } from '@/lib/rbac/project-access';
import { getWorkspaceSubscription } from '@/lib/billing/subscription';
import { planAtLeast } from '@/lib/vault/plan-tier';
import { VAULT_PLAN_LIMITS, type VaultPlanLimits } from '@/types/vault';
import type { PlanCode, SubscriptionStatus } from '@/types/billing';
import type { WorkspaceMembership } from '@/lib/rbac/workspace-access';

// Re-export from the pure client-safe module so all server callers keep working.
export { isProtectedEnvName, canSeeProtectedEnv } from '@/lib/vault/env-policy';
import { canSeeProtectedEnv as _canSeeProtectedEnv } from '@/lib/vault/env-policy';

export interface VaultAccess {
    membership: WorkspaceMembership;
    workspaceId: string;
    isAdmin: boolean;
}

export interface VaultLimitsResult {
    limits: VaultPlanLimits;
    /** Effective tier used for vault limits and feature gates (paid status required). */
    planCode: string;
    workspaceId: string;
    /** Raw `workspace_subscriptions.plan_code` — compare to planCode to spot billing mismatches. */
    subscriptionPlanCode: PlanCode;
    subscriptionStatus: SubscriptionStatus;
}

export async function requireVaultMember(
    projectId: string,
    userId: string
): Promise<VaultAccess> {
    const workspaceId = await getProjectWorkspaceId(projectId);
    if (!workspaceId) {
        throw new WorkspaceAccessError('Project not found.');
    }
    const membership = await requireWorkspaceMember(workspaceId, userId);
    return { membership, workspaceId, isAdmin: isWorkspaceAdmin(membership) };
}

export async function requireVaultAdmin(
    projectId: string,
    userId: string
): Promise<VaultAccess> {
    const access = await requireVaultMember(projectId, userId);
    if (!access.isAdmin) {
        throw new WorkspaceAccessError('Admin or owner access required');
    }
    return access;
}

export interface VaultProAccess extends VaultAccess {
    planCode: string;
}

export async function requireVaultPro(
    projectId: string,
    userId: string
): Promise<VaultProAccess> {
    const access = await requireVaultAdmin(projectId, userId);
    const { planCode } = await getVaultLimits(projectId);
    if (!planAtLeast(planCode, 'pro')) {
        const err = new WorkspaceAccessError('Upgrade required');
        Object.assign(err, { requiredPlan: 'pro' });
        throw err;
    }
    return { ...access, planCode };
}

/** Live Max+ gate for a project (handles billing downgrades). */
export async function assertVaultMaxForProject(projectId: string): Promise<VaultLimitsResult> {
    const limits = await getVaultLimits(projectId);
    if (!planAtLeast(limits.planCode, 'max')) {
        const err = new WorkspaceAccessError('Upgrade required');
        Object.assign(err, { requiredPlan: 'max' });
        throw err;
    }
    return limits;
}

// Member + Max plan (no admin requirement). Members can self-serve CLI tokens.
export async function requireVaultMaxMember(
    projectId: string,
    userId: string
): Promise<VaultProAccess> {
    const access = await requireVaultMember(projectId, userId);
    const { planCode } = await assertVaultMaxForProject(projectId);
    return { ...access, planCode };
}

// Write-side env gate: throws 403 when a non-admin targets a protected env.
export function assertEnvWritable(isAdmin: boolean, envName: string): void {
    if (!_canSeeProtectedEnv(isAdmin, envName)) {
        throw new WorkspaceAccessError('Admin or owner access required for this environment');
    }
}

export async function getVaultLimits(projectId: string): Promise<VaultLimitsResult> {
    const workspaceId = await getProjectWorkspaceId(projectId);
    if (!workspaceId) {
        throw new WorkspaceAccessError('Project not found.');
    }
    const { plan, subscription } = await getWorkspaceSubscription(workspaceId);
    const planCode = plan.code;
    const limits = VAULT_PLAN_LIMITS[planCode] ?? VAULT_PLAN_LIMITS.basic;
    return {
        limits,
        planCode,
        workspaceId,
        subscriptionPlanCode: subscription.plan_code,
        subscriptionStatus: subscription.status,
    };
}
