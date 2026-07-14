import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { requireVaultApiUser } from '@/lib/vault/mfa-route';
import { vaultRouteErrorResponse } from '@/lib/vault/handle-vault-route-error';
import { requireVaultPro } from '@/lib/vault/auth';
import { syncProjectToGitHub } from '@/lib/vault/github-sync';

const bodySchema = z.object({
    projectId: z.string().uuid(),
    syncTargetId: z.string().uuid(),
});

export async function POST(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const body = await request.json();
        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
        }
        const { projectId, syncTargetId } = parsed.data;

        const { workspaceId } = await requireVaultPro(projectId, user.id);

        const result = await syncProjectToGitHub(projectId, workspaceId, syncTargetId, user.id);

        return NextResponse.json({ data: result });
    } catch (e: unknown) {
        const vaultErr = vaultRouteErrorResponse(e);
        if (vaultErr) return vaultErr;
        if (e instanceof WorkspaceAccessError) {
            const extra = (e as WorkspaceAccessError & { requiredPlan?: string }).requiredPlan;
            return NextResponse.json(
                { error: e.message, ...(extra ? { requiredPlan: extra } : {}) },
                { status: e.status ?? 403 }
            );
        }
        const message = e instanceof Error ? e.message : 'Internal server error';
        console.error('[vault/sync/github POST]', e);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
