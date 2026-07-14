import { query, SCHEMA } from '@/lib/db';

export type CliDenyReason =
    | 'invalid_token'
    | 'wrong_project'
    | 'not_member'
    | 'plan'
    | 'rate_limit'
    | 'env_forbidden'
    | 'scope'
    | 'env_not_allowed'
    | 'missing_auth';

export function getClientIp(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
        const first = forwarded.split(',')[0]?.trim();
        if (first) return first;
    }
    return request.headers.get('x-real-ip')?.trim() ?? 'unknown';
}

interface CliAuditContext {
    projectId: string | null;
    workspaceId: string | null;
    actorId: string | null;
    environment?: string;
    tokenId?: string;
    ip: string;
    reason: CliDenyReason;
}

export async function logCliEnvDenied(ctx: CliAuditContext): Promise<void> {
    if (!ctx.projectId || !ctx.workspaceId) return;

    await query(
        `INSERT INTO ${SCHEMA}.vault_audit_log
            (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, metadata)
         VALUES ($1, $2, $3, 'cli_env.denied', 'cli_token', $4, $5)`,
        [
            ctx.projectId,
            ctx.workspaceId,
            ctx.actorId,
            ctx.tokenId ?? null,
            JSON.stringify({
                reason: ctx.reason,
                environment: ctx.environment ?? null,
                ip: ctx.ip,
            }),
        ],
    ).catch((err) => console.error('[vault audit cli_env.denied]', err));
}

export async function logCliAuthFailed(ctx: {
    projectId: string | null;
    ip: string;
    reason: CliDenyReason;
}): Promise<void> {
    if (!ctx.projectId) return;

    await query(
        `INSERT INTO ${SCHEMA}.vault_audit_log
            (project_id, workspace_id, actor_id, event_type, resource_type, resource_id, metadata)
         VALUES ($1, NULL, NULL, 'cli_token.auth_failed', 'cli_token', NULL, $2)`,
        [
            ctx.projectId,
            JSON.stringify({
                reason: ctx.reason,
                ip: ctx.ip,
            }),
        ],
    ).catch((err) => console.error('[vault audit cli_token.auth_failed]', err));
}
