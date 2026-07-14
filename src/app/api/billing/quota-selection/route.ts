import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserFromRequest, query, SCHEMA } from '@/lib/db';
import { PRE_LAUNCH_GATE, isBillingTester } from '@/lib/billing/testers';
import { computeOverQuota, notifyWorkspaceAdmins, selectionAppliedMessage } from '@/lib/billing/reconcile';
import type { QuotaResourceKind, QuotaSelectionPayload } from '@/types/billing';

const bodySchema = z.object({
    workspaceId: z.string().uuid(),
    projects: z.array(z.string().uuid()).optional(),
    channels: z.array(z.string().uuid()).optional(),
}).refine((value) => value.projects !== undefined || value.channels !== undefined, {
    message: 'At least one resource selection is required',
});

function dedupeIds(ids: string[] | undefined): string[] | undefined {
    if (ids === undefined) return undefined;
    return Array.from(new Set(ids));
}

function getLimit(
    resource: QuotaResourceKind,
    resources: Array<{ resource: QuotaResourceKind; limit: number }>,
): number | null {
    return resources.find((row) => row.resource === resource)?.limit ?? null;
}

function getUsed(
    resource: QuotaResourceKind,
    resources: Array<{ resource: QuotaResourceKind; used: number }>,
): number {
    return resources.find((row) => row.resource === resource)?.used ?? 0;
}

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

    const normalized: QuotaSelectionPayload = {
        workspaceId: parsed.data.workspaceId,
        projects: dedupeIds(parsed.data.projects),
        channels: dedupeIds(parsed.data.channels),
    };

    try {
        const memberResult = await query<{ role: string }>(
            `SELECT wm.role FROM ${SCHEMA}.workspace_members wm
             WHERE wm.workspace_id = $1 AND wm.user_id = $2 LIMIT 1`,
            [normalized.workspaceId, user.id],
        );
        const role = memberResult.rows[0]?.role;
        if (!role || (role !== 'owner' && role !== 'admin')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const overQuota = await computeOverQuota(normalized.workspaceId);
        const selectableResources = overQuota.resources.filter(
            (resource) => resource.resource === 'projects' || resource.resource === 'channels',
        );
        const inGrace = !!overQuota.graceUntil && !overQuota.graceExpired;

        if (!inGrace) {
            return NextResponse.json(
                { error: 'Selection changes are only available during the grace period' },
                { status: 403 },
            );
        }

        const projectLimit = getLimit('projects', selectableResources);
        const channelLimit = getLimit('channels', selectableResources);

        if (normalized.projects && projectLimit === null) {
            return NextResponse.json({ error: 'Projects are not currently over limit' }, { status: 400 });
        }
        if (normalized.channels && channelLimit === null) {
            return NextResponse.json({ error: 'Channels are not currently over limit' }, { status: 400 });
        }
        if (normalized.projects && projectLimit !== null && normalized.projects.length > projectLimit) {
            return NextResponse.json({ error: 'Too many projects selected to keep active' }, { status: 400 });
        }
        if (normalized.channels && channelLimit !== null && normalized.channels.length > channelLimit) {
            return NextResponse.json({ error: 'Too many channels selected to keep active' }, { status: 400 });
        }

        if (normalized.projects) {
            const validProjects = await query<{ id: string }>(
                `SELECT id FROM ${SCHEMA}.projects
                 WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
                [normalized.workspaceId, normalized.projects],
            );
            if (validProjects.rows.length !== normalized.projects.length) {
                return NextResponse.json({ error: 'One or more selected projects are invalid' }, { status: 400 });
            }
        }

        if (normalized.channels) {
            const validChannels = await query<{ id: string }>(
                `SELECT id FROM ${SCHEMA}.conversations
                 WHERE workspace_id = $1
                   AND type = 'channel'
                   AND archived_at IS NULL
                   AND id = ANY($2::uuid[])`,
                [normalized.workspaceId, normalized.channels],
            );
            if (validChannels.rows.length !== normalized.channels.length) {
                return NextResponse.json({ error: 'One or more selected channels are invalid' }, { status: 400 });
            }
        }

        if (normalized.projects) {
            await query(
                `UPDATE ${SCHEMA}.projects
                 SET quota_locked = (id <> ALL($2::uuid[])), updated_at = NOW()
                 WHERE workspace_id = $1`,
                [normalized.workspaceId, normalized.projects],
            );
            const lockedCount = Math.max(0, getUsed('projects', overQuota.resources) - normalized.projects.length);
            const { title, content } = selectionAppliedMessage('projects', lockedCount);
            await notifyWorkspaceAdmins(normalized.workspaceId, title, content);
        }

        if (normalized.channels) {
            await query(
                `UPDATE ${SCHEMA}.conversations
                 SET quota_locked = CASE
                        WHEN archived_at IS NOT NULL THEN false
                        ELSE id <> ALL($2::uuid[])
                     END,
                     updated_at = NOW()
                 WHERE workspace_id = $1 AND type = 'channel'`,
                [normalized.workspaceId, normalized.channels],
            );
            const lockedCount = Math.max(0, getUsed('channels', overQuota.resources) - normalized.channels.length);
            const { title, content } = selectionAppliedMessage('channels', lockedCount);
            await notifyWorkspaceAdmins(normalized.workspaceId, title, content);
        }

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[quota-selection] Unexpected error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
