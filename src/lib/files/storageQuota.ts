import { query, SCHEMA } from '@/lib/db';
import { getWorkspaceEntitlements } from '@/lib/billing/subscription';
import { formatStorageBytes } from '@/lib/billing/formatBytes';

export async function getWorkspaceStorageUsed(
    workspaceId: string,
): Promise<number> {
    const usageRes = await query<{ total: string }>(
        `SELECT COALESCE(SUM(file_size), 0)::text AS total FROM ${SCHEMA}.workspace_files WHERE workspace_id = $1`,
        [workspaceId],
    );
    return parseInt(usageRes.rows[0]?.total ?? '0', 10);
}

export async function getWorkspaceStorageLimitBytes(
    workspaceId: string,
): Promise<number> {
    const entitlements = await getWorkspaceEntitlements(workspaceId);
    return entitlements.max_storage_bytes;
}

export interface WorkspaceStorageCheckResult {
    allowed: boolean;
    used: number;
    limit: number;
    error?: string;
    code?: 'WORKSPACE_STORAGE_LIMIT';
}

export async function checkWorkspaceStorage(
    workspaceId: string,
    additionalBytes: number,
): Promise<WorkspaceStorageCheckResult> {
    const [used, limit] = await Promise.all([
        getWorkspaceStorageUsed(workspaceId),
        getWorkspaceStorageLimitBytes(workspaceId),
    ]);

    if (used + additionalBytes > limit) {
        return {
            allowed: false,
            used,
            limit,
            error: `Workspace storage limit reached (${formatStorageBytes(limit)}).`,
            code: 'WORKSPACE_STORAGE_LIMIT',
        };
    }

    return { allowed: true, used, limit };
}

/** @deprecated Use checkWorkspaceStorage — kept for callers migrating incrementally. */
export function wouldExceedWorkspaceStorage(
    usedBytes: number,
    additionalBytes: number,
    limitBytes: number,
): boolean {
    return usedBytes + additionalBytes > limitBytes;
}

export { formatStorageBytes };
