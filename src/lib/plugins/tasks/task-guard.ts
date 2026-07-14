import { query, SCHEMA } from '@/lib/db';

import type { TaskPluginProvider } from './types';

const PROVIDER_LABELS: Record<TaskPluginProvider, string> = {
    trello: 'Trello',
    jira: 'Jira',
    clickup: 'ClickUp',
    asana: 'Asana',
};

export class PluginSourcedTaskError extends Error {
    readonly provider: TaskPluginProvider;

    constructor(provider: TaskPluginProvider) {
        const label = PROVIDER_LABELS[provider] ?? provider;
        super(`Tasks synced from ${label} cannot be deleted in OneWork`);
        this.name = 'PluginSourcedTaskError';
        this.provider = provider;
    }
}

export async function getTaskPluginSource(taskId: string): Promise<TaskPluginProvider | null> {
    const result = await query<{ source: string | null; source_plugin_provider: string | null }>(
        `SELECT source, source_plugin_provider FROM ${SCHEMA}.tasks WHERE id = $1 LIMIT 1`,
        [taskId],
    );
    const row = result.rows[0];
    if (!row || row.source !== 'plugin' || !row.source_plugin_provider) return null;
    const provider = row.source_plugin_provider;
    if (provider === 'trello' || provider === 'jira' || provider === 'clickup' || provider === 'asana') {
        return provider;
    }
    return null;
}

export async function assertTaskDeletableInOneWork(taskId: string): Promise<void> {
    const source = await getTaskPluginSource(taskId);
    if (source) throw new PluginSourcedTaskError(source);
}
