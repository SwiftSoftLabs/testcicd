import { query, SCHEMA } from '@/lib/db';
import { getWorkspaceEntitlements } from '@/lib/billing/subscription';

export interface BillingLimitError {
    allowed: false;
    error: string;
    code: 'BILLING_LIMIT_REACHED';
    limit: number;
    used: number;
    planCode: string;
}

export type EnforceResult = { allowed: true } | BillingLimitError;

export async function checkProjectLimit(workspaceId: string): Promise<EnforceResult> {
    const entitlements = await getWorkspaceEntitlements(workspaceId);
    if (entitlements.max_projects === null) return { allowed: true };

    const result = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.projects WHERE workspace_id = $1`,
        [workspaceId],
    );
    const used = result.rows[0]?.count ?? 0;
    if (used >= entitlements.max_projects) {
        return {
            allowed: false,
            error: `Your ${entitlements.plan_code} plan allows up to ${entitlements.max_projects} project${entitlements.max_projects === 1 ? '' : 's'}. Upgrade to create more.`,
            code: 'BILLING_LIMIT_REACHED',
            limit: entitlements.max_projects,
            used,
            planCode: entitlements.plan_code,
        };
    }
    return { allowed: true };
}

export async function checkSeatLimit(workspaceId: string): Promise<EnforceResult> {
    const entitlements = await getWorkspaceEntitlements(workspaceId);
    if (entitlements.max_seats === null) return { allowed: true };

    const result = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM ${SCHEMA}.workspace_members WHERE workspace_id = $1`,
        [workspaceId],
    );
    const used = result.rows[0]?.count ?? 0;
    if (used >= entitlements.max_seats) {
        return {
            allowed: false,
            error: `Your ${entitlements.plan_code} plan allows up to ${entitlements.max_seats} member${entitlements.max_seats === 1 ? '' : 's'}. Upgrade to invite more.`,
            code: 'BILLING_LIMIT_REACHED',
            limit: entitlements.max_seats,
            used,
            planCode: entitlements.plan_code,
        };
    }
    return { allowed: true };
}

export async function checkChannelLimit(workspaceId: string): Promise<EnforceResult> {
    const entitlements = await getWorkspaceEntitlements(workspaceId);
    if (entitlements.max_channels === null) return { allowed: true };

    const result = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM ${SCHEMA}.conversations
         WHERE workspace_id = $1
           AND type = 'channel'
           AND archived_at IS NULL`,
        [workspaceId],
    );
    const used = result.rows[0]?.count ?? 0;
    if (used >= entitlements.max_channels) {
        return {
            allowed: false,
            error: `Your ${entitlements.plan_code} plan allows up to ${entitlements.max_channels} channel${entitlements.max_channels === 1 ? '' : 's'}. Upgrade to create more.`,
            code: 'BILLING_LIMIT_REACHED',
            limit: entitlements.max_channels,
            used,
            planCode: entitlements.plan_code,
        };
    }
    return { allowed: true };
}

export async function checkInboxLimit(workspaceId: string, userId: string): Promise<EnforceResult> {
    const entitlements = await getWorkspaceEntitlements(workspaceId);
    if (entitlements.max_inboxes_per_user === null) return { allowed: true };

    const result = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM ${SCHEMA}.mail_accounts
         WHERE user_id = $1
           AND status <> 'disconnected'`,
        [userId],
    );
    const used = result.rows[0]?.count ?? 0;
    if (used >= entitlements.max_inboxes_per_user) {
        return {
            allowed: false,
            error: `Your ${entitlements.plan_code} plan allows up to ${entitlements.max_inboxes_per_user} inbox${entitlements.max_inboxes_per_user === 1 ? '' : 'es'} per user. Upgrade to connect more.`,
            code: 'BILLING_LIMIT_REACHED',
            limit: entitlements.max_inboxes_per_user,
            used,
            planCode: entitlements.plan_code,
        };
    }
    return { allowed: true };
}
