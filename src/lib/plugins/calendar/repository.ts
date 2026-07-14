import { query, SCHEMA } from '@/lib/db';
import { decryptPluginSecret, encryptPluginSecret } from './crypto';
import type {
    CalendarPluginInstallationRow,
    CalendarPluginProvider,
    CalendarPluginStatus,
    PluginEventLinkRow,
    PluginSyncOrigin,
} from './types';

export interface UpsertCalendarPluginInstallationInput {
    userId: string;
    provider: CalendarPluginProvider;
    accountEmail: string | null;
    accountName: string | null;
    accountId: string;
    scopes: string[];
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
}

export async function upsertCalendarPluginInstallation(input: UpsertCalendarPluginInstallationInput): Promise<CalendarPluginInstallationRow> {
    const result = await query<CalendarPluginInstallationRow>(
        `INSERT INTO ${SCHEMA}.calendar_plugin_installations (
            user_id, provider, account_email, account_name, account_id, scopes,
            encrypted_token, encrypted_refresh, token_expires_at, status
         ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, 'connected'
         )
         ON CONFLICT (user_id, provider)
         DO UPDATE SET
            account_email = EXCLUDED.account_email,
            account_name = EXCLUDED.account_name,
            account_id = EXCLUDED.account_id,
            scopes = EXCLUDED.scopes,
            encrypted_token = EXCLUDED.encrypted_token,
            encrypted_refresh = COALESCE(EXCLUDED.encrypted_refresh, ${SCHEMA}.calendar_plugin_installations.encrypted_refresh),
            token_expires_at = EXCLUDED.token_expires_at,
            status = 'connected',
            last_sync_error = NULL,
            updated_at = NOW()
         RETURNING *`,
        [
            input.userId,
            input.provider,
            input.accountEmail,
            input.accountName,
            input.accountId,
            input.scopes,
            encryptPluginSecret(input.accessToken),
            input.refreshToken ? encryptPluginSecret(input.refreshToken) : null,
            input.tokenExpiresAt?.toISOString() ?? null,
        ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to persist calendar plugin installation');
    return row;
}

export async function findCalendarPluginInstallation(
    userId: string,
    provider: CalendarPluginProvider,
): Promise<CalendarPluginInstallationRow | null> {
    const result = await query<CalendarPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.calendar_plugin_installations
         WHERE user_id = $1 AND provider = $2 AND status = 'connected'
         LIMIT 1`,
        [userId, provider],
    );
    return result.rows[0] ?? null;
}

export async function findCalendarPluginInstallationById(id: string): Promise<CalendarPluginInstallationRow | null> {
    const result = await query<CalendarPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.calendar_plugin_installations WHERE id = $1 LIMIT 1`,
        [id],
    );
    return result.rows[0] ?? null;
}

export async function listConnectedCalendarPluginInstallations(userId: string): Promise<CalendarPluginInstallationRow[]> {
    const result = await query<CalendarPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.calendar_plugin_installations
         WHERE user_id = $1 AND status = 'connected'
         ORDER BY provider`,
        [userId],
    );
    return result.rows;
}

export async function getCalendarPluginStatuses(userId: string): Promise<CalendarPluginStatus[]> {
    const result = await query<CalendarPluginInstallationRow>(
        `SELECT * FROM ${SCHEMA}.calendar_plugin_installations
         WHERE user_id = $1`,
        [userId],
    );
    const byProvider = new Map(result.rows.map((row) => [row.provider, row]));
    return (['google_calendar', 'outlook', 'calendly'] as const).map((provider) => {
        const row = byProvider.get(provider);
        return {
            provider,
            connected: row?.status === 'connected',
            accountEmail: row?.account_email ?? null,
            accountName: row?.account_name ?? null,
            status: row?.status ?? 'disconnected',
            lastSyncedAt: row?.last_synced_at ?? null,
            lastSyncError: row?.last_sync_error ?? null,
        };
    });
}

export async function deleteCalendarPluginInstallation(userId: string, provider: CalendarPluginProvider): Promise<void> {
    await query(
        `DELETE FROM ${SCHEMA}.calendar_plugin_installations
         WHERE user_id = $1 AND provider = $2`,
        [userId, provider],
    );
}

export async function updateInstallationSettings(
    installationId: string,
    settings: Record<string, unknown>,
): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.calendar_plugin_installations
         SET settings = $1::jsonb, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(settings), installationId],
    );
}

export async function updateInstallationSyncCursor(
    installationId: string,
    syncCursor: Record<string, unknown>,
    lastSyncedAt?: Date,
    lastSyncError?: string | null,
): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.calendar_plugin_installations
         SET sync_cursor = $1::jsonb,
             last_synced_at = COALESCE($2, last_synced_at),
             last_sync_error = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [
            JSON.stringify(syncCursor),
            lastSyncedAt?.toISOString() ?? null,
            lastSyncError ?? null,
            installationId,
        ],
    );
}

export async function markPluginInstallationUsed(id: string): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.calendar_plugin_installations
         SET last_used_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [id],
    );
}

export function decryptAccessToken(row: CalendarPluginInstallationRow): string {
    return decryptPluginSecret(row.encrypted_token);
}

export function decryptRefreshToken(row: CalendarPluginInstallationRow): string | null {
    return row.encrypted_refresh ? decryptPluginSecret(row.encrypted_refresh) : null;
}

export async function replaceAccessToken(
    row: CalendarPluginInstallationRow,
    accessToken: string,
    refreshToken: string | null,
    expiresAt: Date | null,
): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.calendar_plugin_installations
         SET encrypted_token = $1,
             encrypted_refresh = COALESCE($2, encrypted_refresh),
             token_expires_at = $3,
             status = 'connected',
             updated_at = NOW()
         WHERE id = $4`,
        [
            encryptPluginSecret(accessToken),
            refreshToken ? encryptPluginSecret(refreshToken) : null,
            expiresAt?.toISOString() ?? null,
            row.id,
        ],
    );
}

export async function findPluginEventLink(
    installationId: string,
    externalEventId: string,
): Promise<PluginEventLinkRow | null> {
    const result = await query<PluginEventLinkRow>(
        `SELECT * FROM ${SCHEMA}.plugin_event_links
         WHERE installation_id = $1 AND external_event_id = $2
         LIMIT 1`,
        [installationId, externalEventId],
    );
    return result.rows[0] ?? null;
}

export async function findPluginEventLinkByEventId(eventId: string): Promise<PluginEventLinkRow | null> {
    const result = await query<PluginEventLinkRow>(
        `SELECT * FROM ${SCHEMA}.plugin_event_links WHERE event_id = $1 LIMIT 1`,
        [eventId],
    );
    return result.rows[0] ?? null;
}

export async function listPluginEventLinksForInstallation(installationId: string): Promise<PluginEventLinkRow[]> {
    const result = await query<PluginEventLinkRow>(
        `SELECT * FROM ${SCHEMA}.plugin_event_links WHERE installation_id = $1`,
        [installationId],
    );
    return result.rows;
}

export async function upsertPluginEventLink(input: {
    eventId: string;
    installationId: string;
    externalEventId: string;
    externalCalendarId?: string | null;
    externalUpdatedAt?: string | null;
    externalEtag?: string | null;
    syncOrigin: PluginSyncOrigin;
    metadata?: Record<string, unknown>;
}): Promise<PluginEventLinkRow> {
    const result = await query<PluginEventLinkRow>(
        `INSERT INTO ${SCHEMA}.plugin_event_links (
            event_id, installation_id, external_event_id, external_calendar_id,
            external_updated_at, external_etag, sync_origin, metadata, last_pulled_at
         ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::jsonb, NOW())
         ON CONFLICT (installation_id, external_event_id)
         DO UPDATE SET
            event_id = EXCLUDED.event_id,
            external_calendar_id = EXCLUDED.external_calendar_id,
            external_updated_at = EXCLUDED.external_updated_at,
            external_etag = EXCLUDED.external_etag,
            sync_origin = EXCLUDED.sync_origin,
            metadata = EXCLUDED.metadata,
            last_pulled_at = NOW(),
            updated_at = NOW()
         RETURNING *`,
        [
            input.eventId,
            input.installationId,
            input.externalEventId,
            input.externalCalendarId ?? null,
            input.externalUpdatedAt ?? null,
            input.externalEtag ?? null,
            input.syncOrigin,
            JSON.stringify(input.metadata ?? {}),
        ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to persist plugin event link');
    return row;
}

export async function updatePluginEventLinkSyncOrigin(
    linkId: string,
    syncOrigin: PluginSyncOrigin,
    opts?: { lastPushedAt?: boolean; lastPulledAt?: boolean },
): Promise<void> {
    const sets = ['sync_origin = $1', 'updated_at = NOW()'];
    const params: unknown[] = [syncOrigin];
    if (opts?.lastPushedAt) sets.push('last_pushed_at = NOW()');
    if (opts?.lastPulledAt) sets.push('last_pulled_at = NOW()');
    params.push(linkId);
    await query(
        `UPDATE ${SCHEMA}.plugin_event_links SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
    );
}

export async function deletePluginEventLink(linkId: string): Promise<void> {
    await query(`DELETE FROM ${SCHEMA}.plugin_event_links WHERE id = $1`, [linkId]);
}

export async function deletePluginEventsForInstallation(installationId: string): Promise<void> {
    await query(
        `DELETE FROM ${SCHEMA}.events e
         USING ${SCHEMA}.plugin_event_links l
         WHERE l.installation_id = $1
           AND l.event_id = e.id
           AND e.source = 'plugin'`,
        [installationId],
    );
    await query(
        `DELETE FROM ${SCHEMA}.plugin_event_links WHERE installation_id = $1`,
        [installationId],
    );
}
