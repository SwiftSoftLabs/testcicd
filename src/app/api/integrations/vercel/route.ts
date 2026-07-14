import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { isWorkspaceAdmin } from '@/lib/rbac/workspace-access';
import { requireWorkspaceMember } from '@/lib/rbac/workspace-access';
import { query, SCHEMA } from '@/lib/db';
import type { VercelIntegrationRow, VercelIntegrationStatus } from '@/lib/integrations/vercel/types';
import {
    getVercelCicdAllowMembers,
    setVercelCicdAllowMembers,
} from '@/lib/integrations/git/vercel-cicd-access';

const patchSchema = z.object({
    workspaceId: z.string().uuid(),
    cicdAllowMembers: z.boolean(),
});

// GET /api/integrations/vercel?workspaceId=
export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspaceId');
        if (!workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }

        const membership = await requireWorkspaceMember(workspaceId, user.id);

        const result = await query<VercelIntegrationRow & { connected_by_email: string | null }>(
            `SELECT vi.*, u.email AS connected_by_email
             FROM ${SCHEMA}.vercel_integrations vi
             LEFT JOIN auth.users u ON u.id = vi.connected_by
             WHERE vi.workspace_id = $1
             ORDER BY vi.updated_at DESC
             LIMIT 1`,
            [workspaceId]
        );

        const row = result.rows[0];
        const configured = Boolean(
            process.env.VERCEL_CLIENT_ID?.trim() &&
                process.env.VERCEL_CLIENT_SECRET?.trim() &&
                process.env.VERCEL_INTEGRATION_SLUG?.trim(),
        );
        const cicdAllowMembers = await getVercelCicdAllowMembers(workspaceId);

        const status: VercelIntegrationStatus = {
            connected: Boolean(row),
            targetName: row?.target_name ?? null,
            targetId: row?.target_id ?? null,
            connectedBy: row?.connected_by_email ?? null,
            connectedAt: row?.created_at ?? null,
            configured,
            cicdAllowMembers,
            canManageCicdAccess: isWorkspaceAdmin(membership),
        };

        return NextResponse.json({ data: status });
    } catch (e) {
        if (e instanceof WorkspaceAccessError) {
            return NextResponse.json({ error: e.message }, { status: 403 });
        }
        console.error('[vercel GET]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH /api/integrations/vercel — update CI/CD access policy (admin only)
export async function PATCH(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const body = await request.json();
        const parsed = patchSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
                { status: 400 },
            );
        }

        const { workspaceId, cicdAllowMembers } = parsed.data;
        const membership = await requireWorkspaceMember(workspaceId, user.id);
        if (!isWorkspaceAdmin(membership)) {
            return NextResponse.json(
                { error: 'Admin or owner access required' },
                { status: 403 },
            );
        }

        const saved = await setVercelCicdAllowMembers(workspaceId, cicdAllowMembers);
        return NextResponse.json({ data: { cicdAllowMembers: saved } });
    } catch (e) {
        if (e instanceof WorkspaceAccessError) {
            return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
        }
        console.error('[vercel PATCH]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/integrations/vercel — disconnect
export async function DELETE(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const body = await request.json() as { workspaceId?: string };
        const workspaceId = body.workspaceId;
        if (!workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }

        const membership = await requireWorkspaceMember(workspaceId, user.id);
        if (!isWorkspaceAdmin(membership)) {
            return NextResponse.json({ error: 'Admin or owner access required' }, { status: 403 });
        }

        await query(
            `DELETE FROM ${SCHEMA}.vercel_integrations WHERE workspace_id = $1`,
            [workspaceId]
        );

        return NextResponse.json({ data: { disconnected: true } });
    } catch (e) {
        if (e instanceof WorkspaceAccessError) {
            return NextResponse.json({ error: e.message }, { status: 403 });
        }
        console.error('[vercel DELETE]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
