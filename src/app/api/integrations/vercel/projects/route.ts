import { NextResponse } from 'next/server';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { requireWorkspaceMember } from '@/lib/rbac/workspace-access';
import { query, SCHEMA } from '@/lib/db';
import { decryptVercelToken } from '@/lib/integrations/vercel/crypto';
import { listVercelProjects } from '@/lib/integrations/vercel/client';
import type { VercelIntegrationRow } from '@/lib/integrations/vercel/types';

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspaceId');
        if (!workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }

        await requireWorkspaceMember(workspaceId, user.id);

        const result = await query<VercelIntegrationRow>(
            `SELECT * FROM ${SCHEMA}.vercel_integrations WHERE workspace_id = $1 ORDER BY updated_at DESC LIMIT 1`,
            [workspaceId]
        );

        const integration = result.rows[0];
        if (!integration) {
            return NextResponse.json({ error: 'Vercel is not connected. Connect Vercel in Settings → Integrations.' }, { status: 400 });
        }

        const accessToken = decryptVercelToken(integration.access_token_enc);
        const projects = await listVercelProjects(accessToken, integration.target_id);

        return NextResponse.json({ data: projects });
    } catch (e) {
        if (e instanceof WorkspaceAccessError) {
            return NextResponse.json({ error: e.message }, { status: 403 });
        }
        console.error('[vercel/projects GET]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
