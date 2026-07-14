import { query, SCHEMA } from '@/lib/db';

import { decryptTaskPluginSecret, encryptTaskPluginSecret } from './crypto';
import type {
    PluginProjectLinkRow,
    PluginTaskLinkRow,
    ProjectLinkDTO,
    TaskPluginInstallationRow,
    TaskPluginProvider,
    TaskPluginStatus,
    PluginTaskSyncOrigin,
} from './types';

export async function upsertTaskPluginInstallation(input: {
    workspaceId: string;
    installedBy: string;
    provider: TaskPluginProvider;
    accountId: string;
    accountName: string | null;
    accountEmail: string | null;
    accessToken: string;
    refreshToken?: string | null;
    settings?: Record<string, unknown>;
}): Promise<TaskPluginInstallationRow> {
    const result = await query<TaskPluginInstallationRow>(
        `INSERT INTO ${SCHEMA}.task_plugin_installations (
            workspace_id, installed_by, provider, account_id, account_name, account_email,
            encrypted_token, encrypted_refresh, settings, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'connected')
         ON CONFLICT (workspace_id, provider)
         DO UPDATE SET
            installed_by = EXCLUDED.installed_by,
            account_id = EXCLUDED.account_id,
            account_name = EXCLUDED.account_name,
            account_email = EXCLUDED.account_email,
            encrypted_token = EXCLUDED.encrypted_token,
            encrypted_refresh = COALESCE(EXCLUDED.encrypted_refresh, task_plugin_installations.encrypted_refresh),
            settings = COALESCE(EXCLUDED.settings, task_plugin_installations.settings),
            status = 'connected',
            last_sync_error = NULL,
            updated_at = NOW()
         RETURNING *`,
        [
            input.workspaceId,
            input.installedBy,
            input.provider,
            input.accountId,
            input.accountName,
            input.accountEmail,
            encryptTaskPluginSecret(input.accessToken),
            input.refreshToken ? encryptTaskPluginSecret(input.refreshToken) : null,
            JSON.stringify(input.settings ?? {}),
        ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to persist task plugin installation');
    return row;
}

export async function findTaskPluginInstallation(
    workspaceId: string,
    provider: TaskPluginProvider,
): Promise<TaskPluginInstallationRow | null> {
    const result = await query<TaskPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.task_plugin_installations
         WHERE workspace_id = $1 AND provider = $2 AND status = 'connected'
         LIMIT 1`,
        [workspaceId, provider],
    );
    return result.rows[0] ?? null;
}

export async function findTaskPluginInstallationById(id: string): Promise<TaskPluginInstallationRow | null> {
    const result = await query<TaskPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.task_plugin_installations WHERE id = $1 LIMIT 1`,
        [id],
    );
    return result.rows[0] ?? null;
}

export async function getTaskPluginStatus(
    workspaceId: string,
    provider: TaskPluginProvider,
): Promise<TaskPluginStatus> {
    const row = await findTaskPluginInstallation(workspaceId, provider);
    return {
        provider,
        connected: row?.status === 'connected',
        accountName: row?.account_name ?? null,
        accountEmail: row?.account_email ?? null,
        status: row?.status ?? 'disconnected',
        lastSyncedAt: row?.last_synced_at ?? null,
        lastSyncError: row?.last_sync_error ?? null,
    };
}

export async function deleteTaskPluginInstallation(
    workspaceId: string,
    provider: TaskPluginProvider,
): Promise<void> {
    await query(
        `DELETE FROM ${SCHEMA}.task_plugin_installations WHERE workspace_id = $1 AND provider = $2`,
        [workspaceId, provider],
    );
}

export async function updateInstallationSyncState(
    installationId: string,
    opts: { lastSyncedAt?: Date; lastSyncError?: string | null },
): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.task_plugin_installations
         SET last_synced_at = COALESCE($1, last_synced_at),
             last_sync_error = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [
            opts.lastSyncedAt?.toISOString() ?? null,
            opts.lastSyncError ?? null,
            installationId,
        ],
    );
}

export async function mergeInstallationSettings(
    installationId: string,
    patch: Record<string, unknown>,
): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.task_plugin_installations
         SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(patch), installationId],
    );
}

export function decryptInstallationToken(row: TaskPluginInstallationRow): string {
    return decryptTaskPluginSecret(row.encrypted_token);
}

export function decryptInstallationRefresh(row: TaskPluginInstallationRow): string | null {
    if (!row.encrypted_refresh) return null;
    return decryptTaskPluginSecret(row.encrypted_refresh);
}

export async function replaceInstallationAccessToken(
    installationId: string,
    accessToken: string,
    refreshToken: string | null,
): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.task_plugin_installations
         SET encrypted_token = $1,
             encrypted_refresh = COALESCE($2, encrypted_refresh),
             updated_at = NOW()
         WHERE id = $3`,
        [
            encryptTaskPluginSecret(accessToken),
            refreshToken ? encryptTaskPluginSecret(refreshToken) : null,
            installationId,
        ],
    );
}

export async function listProjectLinks(workspaceId: string): Promise<ProjectLinkDTO[]> {
    const result = await query<{
        id: string;
        provider: TaskPluginProvider;
        project_id: string | null;
        project_name: string | null;
        external_container_id: string;
        external_container_name: string | null;
    }>(
        `SELECT l.id, i.provider, l.project_id, p.name AS project_name,
                l.external_container_id, l.external_container_name
         FROM ${SCHEMA}.plugin_project_links l
         JOIN ${SCHEMA}.task_plugin_installations i ON i.id = l.installation_id
         LEFT JOIN ${SCHEMA}.projects p ON p.id = l.project_id
         WHERE i.workspace_id = $1 AND i.status = 'connected'
         ORDER BY i.provider, l.external_container_name`,
        [workspaceId],
    );
    return result.rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        projectId: row.project_id,
        projectName: row.project_name,
        externalContainerId: row.external_container_id,
        externalContainerName: row.external_container_name,
    }));
}

export async function listProjectLinksForInstallation(
    installationId: string,
): Promise<PluginProjectLinkRow[]> {
    const result = await query<PluginProjectLinkRow>(
        `SELECT * FROM ${SCHEMA}.plugin_project_links WHERE installation_id = $1`,
        [installationId],
    );
    return result.rows;
}

export async function createProjectLink(input: {
    installationId: string;
    projectId: string | null;
    externalContainerId: string;
    externalContainerName: string | null;
    statusMap?: Record<string, string>;
}): Promise<PluginProjectLinkRow> {
    const result = await query<PluginProjectLinkRow>(
        `INSERT INTO ${SCHEMA}.plugin_project_links (
            installation_id, project_id, external_container_id, external_container_name, status_map
         ) VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING *`,
        [
            input.installationId,
            input.projectId,
            input.externalContainerId,
            input.externalContainerName,
            JSON.stringify(input.statusMap ?? {}),
        ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to create project link');
    return row;
}

export async function deleteProjectLink(linkId: string): Promise<void> {
    await query(`DELETE FROM ${SCHEMA}.plugin_project_links WHERE id = $1`, [linkId]);
}

export async function findPluginTaskLink(
    installationId: string,
    externalTaskId: string,
): Promise<PluginTaskLinkRow | null> {
    const result = await query<PluginTaskLinkRow>(
        `SELECT * FROM ${SCHEMA}.plugin_task_links
         WHERE installation_id = $1 AND external_task_id = $2
         LIMIT 1`,
        [installationId, externalTaskId],
    );
    return result.rows[0] ?? null;
}

export async function findPluginTaskLinkByTaskId(
    taskId: string,
): Promise<PluginTaskLinkRow | null> {
    const result = await query<PluginTaskLinkRow>(
        `SELECT * FROM ${SCHEMA}.plugin_task_links WHERE task_id = $1 LIMIT 1`,
        [taskId],
    );
    return result.rows[0] ?? null;
}

export async function createPluginTaskLink(input: {
    installationId: string;
    taskId: string;
    externalTaskId: string;
    syncOrigin: PluginTaskSyncOrigin;
    externalUpdatedAt?: string | null;
}): Promise<void> {
    await query(
        `INSERT INTO ${SCHEMA}.plugin_task_links (
            installation_id, task_id, external_task_id, sync_origin, external_updated_at
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (installation_id, external_task_id) DO NOTHING`,
        [
            input.installationId,
            input.taskId,
            input.externalTaskId,
            input.syncOrigin,
            input.externalUpdatedAt ?? null,
        ],
    );
}
