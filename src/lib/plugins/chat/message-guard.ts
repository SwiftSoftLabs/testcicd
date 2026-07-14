import { query, SCHEMA } from '@/lib/db';

import { getPluginMessageSource } from './pluginMessage';
import type { ChatPluginMessageSource } from './pluginMessage';

export class PluginSourcedMessageError extends Error {
    constructor(source: ChatPluginMessageSource) {
        super(`Messages synced from ${source} cannot be edited or deleted in OneWork`);
        this.name = 'PluginSourcedMessageError';
    }
}

export async function getMessagePluginSource(messageId: string): Promise<ChatPluginMessageSource | null> {
    const result = await query<{ metadata: { source?: string } | null }>(
        `SELECT metadata FROM ${SCHEMA}.messages WHERE id = $1 LIMIT 1`,
        [messageId],
    );
    return getPluginMessageSource(result.rows[0]?.metadata ?? undefined);
}

export async function assertMessageEditableInOneWork(messageId: string): Promise<void> {
    const source = await getMessagePluginSource(messageId);
    if (source) throw new PluginSourcedMessageError(source);
}
