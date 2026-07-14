import { query, SCHEMA } from '@/lib/db';
import { insertTask } from '@/lib/tasks/insertTask';

import { mapExternalPriority, mapExternalStatus } from './status-map';
import { createPluginTaskLink, findPluginTaskLink } from './repository';
import type {
    NormalizedPluginTask,
    PluginProjectLinkRow,
    TaskPluginInstallationRow,
} from './types';

async function upsertPluginTaskLinkMeta(
    installationId: string,
    taskId: string,
    externalTaskId: string,
    externalUpdatedAt: string | null,
    syncOrigin: 'import' | 'export',
): Promise<void> {
    await query(
        `INSERT INTO ${SCHEMA}.plugin_task_links (
            installation_id, task_id, external_task_id, sync_origin, external_updated_at
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (installation_id, external_task_id)
         DO UPDATE SET
            task_id = EXCLUDED.task_id,
            external_updated_at = EXCLUDED.external_updated_at,
            updated_at = NOW()`,
        [installationId, taskId, externalTaskId, syncOrigin, externalUpdatedAt],
    );
}

export async function upsertPluginTask(
    installation: TaskPluginInstallationRow,
    link: PluginProjectLinkRow,
    normalized: NormalizedPluginTask,
    installedBy: string,
): Promise<'imported' | 'updated' | 'skipped'> {
    const existing = await findPluginTaskLink(installation.id, normalized.externalId);
    const status = mapExternalStatus(normalized, link.status_map ?? {});
    const priority = normalized.priority ?? mapExternalPriority(normalized.externalStatus);

    let assigneeId: string | null = null;
    if (normalized.assigneeEmail) {
        const member = await query<{ user_id: string }>(
            `SELECT wm.user_id FROM ${SCHEMA}.workspace_members wm
             JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
             WHERE wm.workspace_id = $1 AND LOWER(p.email) = $2
             LIMIT 1`,
            [installation.workspace_id, normalized.assigneeEmail.toLowerCase()],
        );
        assigneeId = member.rows[0]?.user_id ?? null;
    }
    if (!assigneeId) assigneeId = installedBy;

    if (existing) {
        const externalUpdated = normalized.externalUpdatedAt
            ? new Date(normalized.externalUpdatedAt).getTime()
            : 0;
        const linkUpdated = existing.external_updated_at
            ? new Date(existing.external_updated_at).getTime()
            : 0;
        if (externalUpdated && linkUpdated && externalUpdated <= linkUpdated && existing.sync_origin === 'export') {
            return 'skipped';
        }

        await query(
            `UPDATE ${SCHEMA}.tasks
             SET title = $1,
                 description = $2,
                 status = $3,
                 priority = $4,
                 due_date = $5,
                 assignee_id = COALESCE($6, assignee_id),
                 updated_at = NOW()
             WHERE id = $7`,
            [
                normalized.title,
                normalized.description,
                status,
                priority,
                normalized.dueDate ?? null,
                assigneeId,
                existing.task_id,
            ],
        );
        await upsertPluginTaskLinkMeta(
            installation.id,
            existing.task_id,
            normalized.externalId,
            normalized.externalUpdatedAt ?? null,
            'import',
        );
        return 'updated';
    }

    const created = await insertTask({
        workspace_id: installation.workspace_id,
        project_id: link.project_id,
        title: normalized.title,
        description: normalized.description,
        status,
        priority,
        assignee_id: assigneeId,
        due_date: normalized.dueDate ?? null,
        tags: [],
        source: 'plugin',
        source_plugin_provider: installation.provider,
        source_plugin_installation_id: installation.id,
    });
    const taskId = created.id as string | undefined;
    if (!taskId) throw new Error('Failed to insert plugin task');

    await createPluginTaskLink({
        installationId: installation.id,
        taskId,
        externalTaskId: normalized.externalId,
        syncOrigin: 'import',
        externalUpdatedAt: normalized.externalUpdatedAt ?? null,
    });

    return 'imported';
}
