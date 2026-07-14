import { query, SCHEMA } from '@/lib/db';

import { getTaskPluginHandler } from './registry';
import {
    findTaskPluginInstallation,
    findTaskPluginInstallationById,
    findPluginTaskLinkByTaskId,
    listProjectLinksForInstallation,
    updateInstallationSyncState,
} from './repository';
import { mapOneWorkStatusToExternal } from './status-map';
import { upsertPluginTask } from './task-store';
import { validTaskPluginAccessToken } from './tokens';
import type { Status } from '@/types';

import type { PluginProjectLinkRow, PullTasksResult, TaskPluginInstallationRow, TaskPluginProvider } from './types';

export async function syncProjectLink(
    installation: TaskPluginInstallationRow,
    link: PluginProjectLinkRow,
): Promise<PullTasksResult> {
    const handler = getTaskPluginHandler(installation.provider);
    const token = await validTaskPluginAccessToken(installation);
    const tasks = await handler.pullTasks(installation, token, link.external_container_id);
    let imported = 0;
    let updated = 0;
    for (const normalized of tasks) {
        const result = await upsertPluginTask(
            installation,
            link,
            normalized,
            installation.installed_by,
        );
        if (result === 'imported') imported += 1;
        if (result === 'updated') updated += 1;
    }
    return { imported, updated };
}

export async function syncTaskPluginInstallation(
    installation: TaskPluginInstallationRow,
): Promise<{
    workspaceId: string;
    provider: string;
    imported: number;
    updated: number;
    error?: string;
}> {
    try {
        const links = await listProjectLinksForInstallation(installation.id);
        let imported = 0;
        let updated = 0;
        for (const link of links) {
            const r = await syncProjectLink(installation, link);
            imported += r.imported;
            updated += r.updated;
        }
        await updateInstallationSyncState(installation.id, {
            lastSyncedAt: new Date(),
            lastSyncError: null,
        });
        return {
            workspaceId: installation.workspace_id,
            provider: installation.provider,
            imported,
            updated,
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Sync failed';
        await updateInstallationSyncState(installation.id, { lastSyncError: message });
        return {
            workspaceId: installation.workspace_id,
            provider: installation.provider,
            imported: 0,
            updated: 0,
            error: message,
        };
    }
}

export async function syncAllTaskPlugins(
    workspaceId: string,
    provider?: TaskPluginProvider,
): Promise<{ imported: number; updated: number; error?: string }> {
    const providers: TaskPluginProvider[] = provider
        ? [provider]
        : ['trello', 'jira', 'clickup', 'asana'];
    let imported = 0;
    let updated = 0;
    let lastError: string | undefined;

    for (const p of providers) {
        const installation = await findTaskPluginInstallation(workspaceId, p);
        if (!installation) continue;
        const result = await syncTaskPluginInstallation(installation);
        imported += result.imported;
        updated += result.updated;
        if (result.error) lastError = result.error;
    }

    if (!provider) {
        const any = await Promise.all(providers.map((p) => findTaskPluginInstallation(workspaceId, p)));
        if (!any.some(Boolean)) throw new Error('No task plugins connected for this workspace');
    } else if (!(await findTaskPluginInstallation(workspaceId, provider))) {
        throw new Error(`${provider} is not connected for this workspace`);
    }

    return { imported, updated, error: lastError };
}

export async function pushTaskUpdateIfLinked(taskId: string): Promise<void> {
    const link = await findPluginTaskLinkByTaskId(taskId);
    if (!link) return;

    const installation = await findTaskPluginInstallationById(link.installation_id);
    if (!installation || installation.status !== 'connected') return;

    const taskRes = await query<{
        title: string;
        description: string | null;
        status: string;
        priority: string;
        due_date: string | null;
    }>(`SELECT title, description, status, priority, due_date FROM ${SCHEMA}.tasks WHERE id = $1`, [
        taskId,
    ]);
    const task = taskRes.rows[0];
    if (!task) return;

    const projectLink = await query<{
        external_container_id: string;
        status_map: Record<string, string>;
    }>(
        `SELECT external_container_id, status_map FROM ${SCHEMA}.plugin_project_links
         WHERE installation_id = $1 LIMIT 1`,
        [installation.id],
    );
    const pl = projectLink.rows[0];
    if (!pl) return;

    const handler = getTaskPluginHandler(installation.provider);
    if (!handler.pushTaskUpdate) return;

    const token = await validTaskPluginAccessToken(installation);
    const externalStatus = mapOneWorkStatusToExternal(task.status as Status, pl.status_map ?? {});

    await handler.pushTaskUpdate(
        installation,
        token,
        link.external_task_id,
        {
            title: task.title,
            description: task.description,
            status: externalStatus,
            priority: task.priority,
            dueDate: task.due_date,
        },
        {
            externalContainerId: pl.external_container_id,
            statusMap: pl.status_map ?? {},
        },
    );
}
