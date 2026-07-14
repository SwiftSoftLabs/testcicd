import { query, SCHEMA } from '@/lib/db';

type LockedResource = 'project' | 'channel' | 'inbox';

function defaultQuotaLockedMessage(resource: LockedResource): string {
    return `This ${resource} is read-only because your workspace is over its plan limit. Upgrade to restore access.`;
}

export class QuotaLockedError extends Error {
    resource: LockedResource;

    constructor(resource: LockedResource, message = defaultQuotaLockedMessage(resource)) {
        super(message);
        this.name = 'QuotaLockedError';
        this.resource = resource;
    }
}

export async function assertProjectWritable(projectId: string | null | undefined): Promise<void> {
    if (!projectId) return;

    const result = await query<{ quota_locked: boolean }>(
        `SELECT quota_locked FROM ${SCHEMA}.projects WHERE id = $1 LIMIT 1`,
        [projectId],
    );

    if (result.rows[0]?.quota_locked) {
        throw new QuotaLockedError('project');
    }
}

export async function assertTaskWritable(taskId: string): Promise<void> {
    const result = await query<{ project_id: string | null }>(
        `SELECT project_id FROM ${SCHEMA}.tasks WHERE id = $1 LIMIT 1`,
        [taskId],
    );

    await assertProjectWritable(result.rows[0]?.project_id ?? null);
}

export async function assertChannelWritable(conversationId: string | null | undefined): Promise<void> {
    if (!conversationId) return;

    const result = await query<{ quota_locked: boolean }>(
        `SELECT quota_locked FROM ${SCHEMA}.conversations WHERE id = $1 LIMIT 1`,
        [conversationId],
    );

    if (result.rows[0]?.quota_locked) {
        throw new QuotaLockedError('channel');
    }
}

export async function assertMailAccountWritable(mailAccountId: string | null | undefined): Promise<void> {
    if (!mailAccountId) return;

    const result = await query<{ quota_locked: boolean }>(
        `SELECT quota_locked FROM ${SCHEMA}.mail_accounts WHERE id = $1 LIMIT 1`,
        [mailAccountId],
    );

    if (result.rows[0]?.quota_locked) {
        throw new QuotaLockedError('inbox');
    }
}
