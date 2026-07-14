import { refreshTeamsAccessToken } from './teams';
import {
    decryptInstallationRefresh,
    decryptInstallationToken,
    replaceInstallationAccessToken,
} from './repository';
import type { ChatPluginInstallationRow } from './types';

function tokenExpiresAt(row: ChatPluginInstallationRow): number | null {
    const raw = row.settings?.tokenExpiresAt;
    if (typeof raw !== 'string') return null;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : null;
}

export async function validChatPluginAccessToken(row: ChatPluginInstallationRow): Promise<string> {
    if (row.provider === 'teams') {
        const expires = tokenExpiresAt(row);
        if (expires && expires < Date.now() + 120_000) {
            return refreshChatTeamsToken(row);
        }
    }
    return decryptInstallationToken(row);
}

export async function refreshChatTeamsToken(row: ChatPluginInstallationRow): Promise<string> {
    const refreshToken = decryptInstallationRefresh(row);
    if (!refreshToken) throw new Error('Reconnect Microsoft Teams to refresh access');
    const data = await refreshTeamsAccessToken(refreshToken);
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    await replaceInstallationAccessToken(row.id, data.access_token, data.refresh_token ?? null, expiresAt);
    return data.access_token;
}
