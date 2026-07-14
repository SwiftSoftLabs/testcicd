import { refreshAsanaToken } from './asana';
import { refreshJiraToken } from './jira';
import {
    decryptInstallationRefresh,
    decryptInstallationToken,
    replaceInstallationAccessToken,
} from './repository';
import type { TaskPluginInstallationRow } from './types';

export async function validTaskPluginAccessToken(row: TaskPluginInstallationRow): Promise<string> {
    const expires = row.settings?.tokenExpiresAt;
    const needsRefresh =
        typeof expires === 'string' && new Date(expires).getTime() < Date.now() + 120_000;
    if (needsRefresh && row.encrypted_refresh) {
        if (row.provider === 'jira') return refreshJiraTaskToken(row);
        if (row.provider === 'asana') return refreshAsanaTaskToken(row);
    }
    return decryptInstallationToken(row);
}

export async function refreshAsanaTaskToken(row: TaskPluginInstallationRow): Promise<string> {
    const refreshToken = decryptInstallationRefresh(row);
    if (!refreshToken) throw new Error('Reconnect Asana to refresh access');
    const data = await refreshAsanaToken(refreshToken);
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    await replaceInstallationAccessToken(row.id, data.access_token, data.refresh_token ?? null);
    const { mergeInstallationSettings } = await import('./repository');
    await mergeInstallationSettings(row.id, { tokenExpiresAt: expiresAt.toISOString() });
    return data.access_token;
}

export async function refreshJiraTaskToken(row: TaskPluginInstallationRow): Promise<string> {
    const refreshToken = decryptInstallationRefresh(row);
    if (!refreshToken) throw new Error('Reconnect Jira to refresh access');
    const data = await refreshJiraToken(refreshToken);
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    await replaceInstallationAccessToken(row.id, data.access_token, data.refresh_token ?? null);
    const { mergeInstallationSettings } = await import('./repository');
    await mergeInstallationSettings(row.id, { tokenExpiresAt: expiresAt.toISOString() });
    return data.access_token;
}
