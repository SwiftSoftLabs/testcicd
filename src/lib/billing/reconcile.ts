import { query, SCHEMA } from '@/lib/db';
import type { OverQuotaResource, OverQuotaState, QuotaResourceKind } from '@/types/billing';

export const GRACE_PERIOD_DAYS = 14;

interface EffectiveLimits {
    planName: string;
    limits: {
        projects: number | null;
        seats: number | null;
        channels: number | null;
        inboxes: number | null; // per user
    };
    graceUntil: string | null;
}

// Resolve the limits that currently apply to a workspace WITHOUT going through
// getWorkspaceSubscription (which would recurse, since the lazy reconcile hook
// lives inside it). Mirrors the entitlement rule: paid statuses use the plan's
// limits, everything else falls back to Basic. quota_grace_until is read from
// the latest row regardless of status — a cancelled→Basic workspace keeps its
// grace stamp on the now-cancelled row.
async function getEffectiveLimits(workspaceId: string): Promise<EffectiveLimits> {
    const result = await query<{
        plan_name: string;
        max_projects: number | null;
        max_seats: number | null;
        max_channels: number | null;
        max_inboxes_per_user: number | null;
        quota_grace_until: string | null;
    }>(
        `WITH latest AS (
             SELECT plan_code, status, quota_grace_until
             FROM ${SCHEMA}.workspace_subscriptions
             WHERE workspace_id = $1
             ORDER BY created_at DESC
             LIMIT 1
         )
         SELECT
             eff.name             AS plan_name,
             eff.max_projects,
             eff.max_seats,
             eff.max_channels,
             eff.max_inboxes_per_user,
             latest.quota_grace_until
         FROM ${SCHEMA}.billing_plans eff
         LEFT JOIN latest ON true
         WHERE eff.code = CASE
             WHEN latest.status IN ('active', 'past_due', 'trialing') THEN latest.plan_code
             ELSE 'basic'
         END`,
        [workspaceId],
    );

    const row = result.rows[0];
    return {
        planName: row?.plan_name ?? 'Basic',
        limits: {
            projects: row?.max_projects ?? null,
            seats: row?.max_seats ?? null,
            channels: row?.max_channels ?? null,
            inboxes: row?.max_inboxes_per_user ?? null,
        },
        graceUntil: row?.quota_grace_until ?? null,
    };
}

interface UsageRow {
    projects: number;
    seats: number;
    channels: number;
    max_inboxes_per_user: number; // highest inbox count held by any one member
    projects_locked: number;
    channels_locked: number;
    inboxes_locked: number;
}

async function getUsage(workspaceId: string): Promise<UsageRow> {
    const result = await query<UsageRow>(
        `SELECT
            (SELECT COUNT(*)::int FROM ${SCHEMA}.projects WHERE workspace_id = $1) AS projects,
            (SELECT COUNT(*)::int FROM ${SCHEMA}.workspace_members WHERE workspace_id = $1) AS seats,
            (SELECT COUNT(*)::int
             FROM ${SCHEMA}.conversations
             WHERE workspace_id = $1
               AND type = 'channel'
               AND archived_at IS NULL) AS channels,
            (SELECT COALESCE(MAX(cnt), 0)::int FROM (
                SELECT COUNT(*) AS cnt FROM ${SCHEMA}.mail_accounts ma
                JOIN ${SCHEMA}.workspace_members wm ON wm.user_id = ma.user_id
                WHERE wm.workspace_id = $1
                  AND ma.status <> 'disconnected'
                GROUP BY ma.user_id
             ) t) AS max_inboxes_per_user,
            (SELECT COUNT(*)::int FROM ${SCHEMA}.projects WHERE workspace_id = $1 AND quota_locked) AS projects_locked,
            (SELECT COUNT(*)::int
             FROM ${SCHEMA}.conversations
             WHERE workspace_id = $1
               AND type = 'channel'
               AND archived_at IS NULL
               AND quota_locked) AS channels_locked,
            (SELECT COUNT(*)::int FROM ${SCHEMA}.mail_accounts ma
             JOIN ${SCHEMA}.workspace_members wm ON wm.user_id = ma.user_id
             WHERE wm.workspace_id = $1
               AND ma.status <> 'disconnected'
               AND ma.quota_locked) AS inboxes_locked`,
        [workspaceId],
    );
    const row = result.rows[0];
    return {
        projects: row?.projects ?? 0,
        seats: row?.seats ?? 0,
        channels: row?.channels ?? 0,
        max_inboxes_per_user: row?.max_inboxes_per_user ?? 0,
        projects_locked: row?.projects_locked ?? 0,
        channels_locked: row?.channels_locked ?? 0,
        inboxes_locked: row?.inboxes_locked ?? 0,
    };
}

function buildOverQuotaState(
    planName: string,
    limits: EffectiveLimits['limits'],
    graceUntil: string | null,
    usage: UsageRow,
): OverQuotaState {
    const resources: OverQuotaResource[] = [];
    const pushIfOver = (
        resource: QuotaResourceKind,
        used: number,
        limit: number | null,
        locked: number,
    ) => {
        if (limit !== null && used > limit) {
            resources.push({ resource, used, limit, locked });
        }
    };

    pushIfOver('projects', usage.projects, limits.projects, usage.projects_locked);
    pushIfOver('seats', usage.seats, limits.seats, 0);
    pushIfOver('channels', usage.channels, limits.channels, usage.channels_locked);
    pushIfOver('inboxes', usage.max_inboxes_per_user, limits.inboxes, usage.inboxes_locked);

    return {
        planName,
        isOverQuota: resources.length > 0,
        graceUntil,
        graceExpired: !!graceUntil && new Date(graceUntil).getTime() <= Date.now(),
        resources,
    };
}

// Pure comparison of current usage against the effective limits. No side effects.
// Used by the summary API (live banner) and by evaluateQuotaGrace.
export async function computeOverQuota(workspaceId: string): Promise<OverQuotaState> {
    const [{ planName, limits, graceUntil }, usage] = await Promise.all([
        getEffectiveLimits(workspaceId),
        getUsage(workspaceId),
    ]);
    return buildOverQuotaState(planName, limits, graceUntil, usage);
}

// --- Notifications -----------------------------------------------------------

// Shared with the Kelviq webhook. Billing alerts are mandatory — no preference
// filtering (unlike the calls notifier).
export async function notifyWorkspaceAdmins(
    workspaceId: string,
    title: string,
    content: string,
): Promise<void> {
    await query(
        `INSERT INTO ${SCHEMA}.notifications (user_id, title, content, type)
         SELECT user_id, $2, $3, 'system'
         FROM ${SCHEMA}.workspace_members
         WHERE workspace_id = $1 AND role IN ('owner', 'admin')`,
        [workspaceId, title, content],
    );
}

function formatDate(iso: string): string {
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(iso));
}

const RESOURCE_LABEL: Record<QuotaResourceKind, string> = {
    projects: 'projects',
    seats: 'members',
    channels: 'channels',
    inboxes: 'inboxes',
};

function graceStartMessage(
    planName: string,
    r: OverQuotaResource,
    graceUntil?: string,
): { title: string; content: string } {
    if (r.resource === 'seats') {
        return {
            title: `Action needed: too many members for the ${planName} plan`,
            content:
                `Your plan allows ${r.limit} seats; you have ${r.used}. Until you deactivate ` +
                `${r.used - r.limit} member(s), inviting and member changes are paused. ` +
                `We won't remove anyone for you.`,
        };
    }
    const label = RESOURCE_LABEL[r.resource];
    const perUser = r.resource === 'inboxes' ? ' per user' : '';
    const deadline = graceUntil ? formatDate(graceUntil) : 'your grace deadline';
    return {
        title: `Action needed: your workspace is over the ${planName} plan limits`,
        content:
            `Your plan allows ${r.limit} ${label}${perUser}, but you have ${r.used}. ` +
            `Reduce to ${r.limit} by ${deadline}, or we'll keep your ${r.limit} ` +
            `oldest ${label} active and switch the newest ${r.used - r.limit} to read-only. ` +
            `Nothing is deleted — re-upgrading restores full access.`,
    };
}

function lockAppliedMessage(label: string, limit: number, locked: number): { title: string; content: string } {
    return {
        title: 'Read-only limits applied',
        content:
            `We kept your ${limit} oldest ${label} active and set ${locked} to read-only. ` +
            `Upgrade to restore full access, or delete locked items to free them up.`,
    };
}

export function selectionAppliedMessage(label: string, locked: number): { title: string; content: string } {
    return {
        title: 'Read-only limits applied',
        content:
            `${locked} ${label} you did not choose are now read-only. ` +
            `Upgrade to restore full access, or change your selection any time.`,
    };
}

interface ResourceSyncResult {
    newlyLocked: number;
}

async function syncProjectLocks(
    workspaceId: string,
    limit: number | null,
): Promise<ResourceSyncResult> {
    const result = await query<{ quota_locked: boolean }>(
        `WITH ranked AS (
             SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
             FROM ${SCHEMA}.projects
             WHERE workspace_id = $1
         ),
         updated AS (
             UPDATE ${SCHEMA}.projects p
             SET quota_locked = CASE
                 WHEN $2::int IS NULL THEN false
                 ELSE ranked.rn > $2
             END
             FROM ranked
             WHERE p.id = ranked.id
               AND p.quota_locked IS DISTINCT FROM CASE
                   WHEN $2::int IS NULL THEN false
                   ELSE ranked.rn > $2
               END
             RETURNING p.quota_locked
         )
         SELECT quota_locked FROM updated`,
        [workspaceId, limit],
    );
    return {
        newlyLocked: result.rows.filter((row) => row.quota_locked).length,
    };
}

async function syncChannelLocks(
    workspaceId: string,
    limit: number | null,
): Promise<ResourceSyncResult> {
    const result = await query<{ quota_locked: boolean }>(
        `WITH ranked AS (
             SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
             FROM ${SCHEMA}.conversations
             WHERE workspace_id = $1
               AND type = 'channel'
               AND archived_at IS NULL
         ),
         updated AS (
             UPDATE ${SCHEMA}.conversations c
             SET quota_locked = CASE
                 WHEN c.archived_at IS NOT NULL OR $2::int IS NULL THEN false
                 ELSE COALESCE(ranked.rn, 0) > $2
             END
             FROM (SELECT id FROM ${SCHEMA}.conversations WHERE workspace_id = $1 AND type = 'channel') target
             LEFT JOIN ranked ON ranked.id = target.id
             WHERE c.id = target.id
               AND c.quota_locked IS DISTINCT FROM CASE
                   WHEN c.archived_at IS NOT NULL OR $2::int IS NULL THEN false
                   ELSE COALESCE(ranked.rn, 0) > $2
               END
             RETURNING c.quota_locked
         )
         SELECT quota_locked FROM updated`,
        [workspaceId, limit],
    );
    return {
        newlyLocked: result.rows.filter((row) => row.quota_locked).length,
    };
}

async function syncInboxLocks(
    workspaceId: string,
    limit: number | null,
): Promise<ResourceSyncResult> {
    const result = await query<{ quota_locked: boolean }>(
        `WITH member_accounts AS (
             SELECT ma.id, ma.user_id, ma.status
             FROM ${SCHEMA}.mail_accounts ma
             JOIN ${SCHEMA}.workspace_members wm ON wm.user_id = ma.user_id
             WHERE wm.workspace_id = $1
         ),
         ranked AS (
             SELECT ma.id, ROW_NUMBER() OVER (PARTITION BY ma.user_id ORDER BY ma.created_at ASC) AS rn
             FROM ${SCHEMA}.mail_accounts ma
             JOIN ${SCHEMA}.workspace_members wm ON wm.user_id = ma.user_id
             WHERE wm.workspace_id = $1
               AND ma.status <> 'disconnected'
         ),
         updated AS (
             UPDATE ${SCHEMA}.mail_accounts m
             SET quota_locked = CASE
                 WHEN accounts.status = 'disconnected' OR $2::int IS NULL THEN false
                 ELSE COALESCE(ranked.rn, 0) > $2
             END
             FROM member_accounts accounts
             LEFT JOIN ranked ON ranked.id = accounts.id
             WHERE m.id = accounts.id
               AND m.quota_locked IS DISTINCT FROM CASE
                   WHEN accounts.status = 'disconnected' OR $2::int IS NULL THEN false
                   ELSE COALESCE(ranked.rn, 0) > $2
               END
             RETURNING m.quota_locked
         )
         SELECT quota_locked FROM updated`,
        [workspaceId, limit],
    );
    return {
        newlyLocked: result.rows.filter((row) => row.quota_locked).length,
    };
}

function shouldSyncLockedResource(
    used: number,
    limit: number | null,
    locked: number,
    allowNewLocks: boolean,
): boolean {
    if (limit === null) return locked > 0;
    const targetLocked = Math.max(0, used - limit);
    if (targetLocked === 0) return locked > 0;
    if (allowNewLocks) return true;
    return targetLocked <= locked;
}

interface LockSyncSummary {
    projects: ResourceSyncResult;
    channels: ResourceSyncResult;
    inboxes: ResourceSyncResult;
}

async function syncQuotaLocks(
    workspaceId: string,
    limits: EffectiveLimits['limits'],
    usage: UsageRow,
    allowNewLocks: boolean,
): Promise<LockSyncSummary> {
    const [projects, channels, inboxes] = await Promise.all([
        shouldSyncLockedResource(usage.projects, limits.projects, usage.projects_locked, allowNewLocks)
            ? syncProjectLocks(workspaceId, limits.projects)
            : Promise.resolve({ newlyLocked: 0 }),
        shouldSyncLockedResource(usage.channels, limits.channels, usage.channels_locked, allowNewLocks)
            ? syncChannelLocks(workspaceId, limits.channels)
            : Promise.resolve({ newlyLocked: 0 }),
        shouldSyncLockedResource(usage.max_inboxes_per_user, limits.inboxes, usage.inboxes_locked, allowNewLocks)
            ? syncInboxLocks(workspaceId, limits.inboxes)
            : Promise.resolve({ newlyLocked: 0 }),
    ]);

    return { projects, channels, inboxes };
}

// --- Grace + lock + restore --------------------------------------------------

// Called on plan transitions only (webhook events + the deferred-cancel→Basic
// flip), never on every read. Starts a grace window when usage exceeds an
// auto-lockable limit; clears grace + unlocks when usage is back within limits.
export async function evaluateQuotaGrace(workspaceId: string): Promise<void> {
    const [{ planName, limits, graceUntil }, usage] = await Promise.all([
        getEffectiveLimits(workspaceId),
        getUsage(workspaceId),
    ]);
    const state = buildOverQuotaState(planName, limits, graceUntil, usage);
    const autoLockOver = state.resources.filter((r) => r.resource !== 'seats');
    const seatOver = state.resources.find((r) => r.resource === 'seats');

    if (!seatOver) {
        await query(
            `UPDATE ${SCHEMA}.workspace_subscriptions
             SET seat_over_notified_at = NULL, updated_at = NOW()
             WHERE workspace_id = $1 AND seat_over_notified_at IS NOT NULL`,
            [workspaceId],
        );
    }

    if (autoLockOver.length > 0) {
        // Stamp the grace window if one isn't already running. RETURNING tells us
        // whether we actually set it (so we only notify once per downgrade).
        const set = await query<{ quota_grace_until: string }>(
            `UPDATE ${SCHEMA}.workspace_subscriptions
             SET quota_grace_until = NOW() + ($2 || ' days')::interval, updated_at = NOW()
             WHERE id = (
                 SELECT id FROM ${SCHEMA}.workspace_subscriptions
                 WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1
             )
             AND quota_grace_until IS NULL
             RETURNING quota_grace_until`,
            [workspaceId, String(GRACE_PERIOD_DAYS)],
        );
        const nextGraceUntil = set.rows[0]?.quota_grace_until ?? state.graceUntil;
        if (set.rows[0]?.quota_grace_until) {
            for (const r of state.resources) {
                const { title, content } = graceStartMessage(state.planName, r, nextGraceUntil);
                await notifyWorkspaceAdmins(workspaceId, title, content);
            }
            return;
        }

        const graceExpired = !!nextGraceUntil && new Date(nextGraceUntil).getTime() <= Date.now();
        const syncSummary = await syncQuotaLocks(workspaceId, limits, usage, graceExpired);
        if (graceExpired) {
            if (syncSummary.projects.newlyLocked > 0 && limits.projects !== null) {
                const { title, content } = lockAppliedMessage('projects', limits.projects, syncSummary.projects.newlyLocked);
                await notifyWorkspaceAdmins(workspaceId, title, content);
            }
            if (syncSummary.channels.newlyLocked > 0 && limits.channels !== null) {
                const { title, content } = lockAppliedMessage('channels', limits.channels, syncSummary.channels.newlyLocked);
                await notifyWorkspaceAdmins(workspaceId, title, content);
            }
            if (syncSummary.inboxes.newlyLocked > 0 && limits.inboxes !== null) {
                const { title, content } = lockAppliedMessage('inboxes', limits.inboxes, syncSummary.inboxes.newlyLocked);
                await notifyWorkspaceAdmins(workspaceId, title, content);
            }
        }
        return;
    }

    // Not over on anything auto-lockable. Clear any grace window and unlock.
    await clearQuotaLocks(workspaceId);
    if (seatOver) {
        const notified = await query<{ seat_over_notified_at: string }>(
            `UPDATE ${SCHEMA}.workspace_subscriptions
             SET seat_over_notified_at = NOW(), updated_at = NOW()
             WHERE id = (
                 SELECT id FROM ${SCHEMA}.workspace_subscriptions
                 WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1
             )
             AND seat_over_notified_at IS NULL
             RETURNING seat_over_notified_at`,
            [workspaceId],
        );
        if (notified.rows[0]?.seat_over_notified_at) {
            const { title, content } = graceStartMessage(state.planName, seatOver);
            await notifyWorkspaceAdmins(workspaceId, title, content);
        }
    }
}

// Cheap lazy hook called from getWorkspaceSubscription on every read. Fast-paths
// out when there's no expired grace window (single indexed lookup). Only when
// the window has elapsed does it fetch limits and freeze the excess.
export async function applyQuotaLocksIfDue(workspaceId: string): Promise<void> {
    const graceRow = await query<{ quota_grace_until: string | null }>(
        `SELECT quota_grace_until FROM ${SCHEMA}.workspace_subscriptions
         WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [workspaceId],
    );
    const graceUntil = graceRow.rows[0]?.quota_grace_until ?? null;
    if (!graceUntil || new Date(graceUntil).getTime() > Date.now()) return;
    await evaluateQuotaGrace(workspaceId);
}

// Restore on upgrade: unlock everything and end the grace window.
export async function clearQuotaLocks(workspaceId: string): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.projects SET quota_locked = false
         WHERE workspace_id = $1 AND quota_locked`,
        [workspaceId],
    );
    await query(
        `UPDATE ${SCHEMA}.conversations SET quota_locked = false
         WHERE workspace_id = $1 AND quota_locked`,
        [workspaceId],
    );
    await query(
        `UPDATE ${SCHEMA}.mail_accounts SET quota_locked = false
         WHERE user_id IN (SELECT user_id FROM ${SCHEMA}.workspace_members WHERE workspace_id = $1)
           AND quota_locked`,
        [workspaceId],
    );
    await query(
        `UPDATE ${SCHEMA}.workspace_subscriptions SET quota_grace_until = NULL, updated_at = NOW()
         WHERE workspace_id = $1 AND quota_grace_until IS NOT NULL`,
        [workspaceId],
    );
}
