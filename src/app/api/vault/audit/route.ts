import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { requireVaultApiUser } from '@/lib/vault/mfa-route';
import { vaultRouteErrorResponse } from '@/lib/vault/handle-vault-route-error';
import { requireVaultAdmin } from '@/lib/vault/auth';
import { query, SCHEMA } from '@/lib/db';
import type { VaultAuditEntry } from '@/types/vault';

const querySchema = z.object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid().optional(),
    before: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
    try {
        const user = await requireVaultApiUser(request);
        const { searchParams } = new URL(request.url);
        const parsed = querySchema.safeParse({
            projectId: searchParams.get('projectId'),
            environmentId: searchParams.get('environmentId') ?? undefined,
            before: searchParams.get('before') ?? undefined,
            limit: searchParams.get('limit') ?? 50,
        });
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
        }
        const { projectId, environmentId, before, limit } = parsed.data;

        await requireVaultAdmin(projectId, user.id);

        const params: unknown[] = [projectId, limit + 1]; // fetch one extra to determine nextCursor
        let whereExtra = '';
        let paramIdx = 3;

        if (environmentId) {
            whereExtra += ` AND al.environment_id = $${paramIdx}`;
            params.push(environmentId);
            paramIdx++;
        }
        if (before) {
            whereExtra += ` AND al.created_at < $${paramIdx}::timestamptz`;
            params.push(before);
            paramIdx++;
        }

        const result = await query<VaultAuditEntry & { actor_email: string | null; actor_name: string | null }>(
            `SELECT
                al.id, al.project_id, al.workspace_id, al.actor_id,
                al.event_type, al.resource_type, al.resource_id, al.environment_id,
                al.metadata, al.created_at,
                p.email AS actor_email,
                p.full_name AS actor_name
             FROM ${SCHEMA}.vault_audit_log al
             LEFT JOIN ${SCHEMA}.profiles p ON p.id = al.actor_id
             WHERE al.project_id = $1${whereExtra}
             ORDER BY al.created_at DESC
             LIMIT $2`,
            params
        );

        const rows = result.rows;
        let nextCursor: string | null = null;

        if (rows.length > limit) {
            rows.pop();
            nextCursor = rows[rows.length - 1]?.created_at ?? null;
        }

        return NextResponse.json({ data: rows, nextCursor });
    } catch (e: unknown) {
        const vaultErr = vaultRouteErrorResponse(e);
        if (vaultErr) return vaultErr;
        if (e instanceof WorkspaceAccessError) {
            return NextResponse.json({ error: e.message }, { status: e.status ?? 403 });
        }
        console.error('[vault/audit]', e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
