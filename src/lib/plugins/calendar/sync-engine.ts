import { query, SCHEMA } from '@/lib/db';
import type { CalendarEventDTO } from '@/types/calendar';
import { toPluginEventSnapshot } from './google';
import { getCalendarPluginHandler } from './registry';
import { cancelOrDeletePluginEventByExternalId, upsertPluginCalendarEvent } from './event-store';
import {
    findCalendarPluginInstallation,
    findCalendarPluginInstallationById,
    findPluginEventLinkByEventId,
    listConnectedCalendarPluginInstallations,
    updateInstallationSyncCursor,
    updatePluginEventLinkSyncOrigin,
    upsertPluginEventLink,
} from './repository';
import type { CalendarPluginInstallationRow } from './types';
import type { CalendarPluginProvider, PluginEventSnapshot } from './types';

const SYNC_DEBOUNCE_MS = 5000;

export interface SyncInstallationResult {
    provider: CalendarPluginProvider;
    pulled: number;
    deleted: number;
    error?: string;
}

export async function syncCalendarPluginInstallation(
    installation: CalendarPluginInstallationRow,
): Promise<SyncInstallationResult> {
    const handler = getCalendarPluginHandler(installation.provider);
    try {
        const { events, deletedExternalIds, nextCursor } = await handler.pullChanges(installation);
        let pulled = 0;
        for (const event of events) {
            await upsertPluginCalendarEvent(installation, event);
            pulled += 1;
        }
        for (const externalId of deletedExternalIds) {
            await cancelOrDeletePluginEventByExternalId(installation.id, externalId);
        }
        await updateInstallationSyncCursor(installation.id, nextCursor, new Date(), null);
        if (handler.registerWebhook && handler.capabilities.supportsWebhooks) {
            try {
                await handler.registerWebhook(installation);
            } catch {
                /* webhooks optional */
            }
        }
        return {
            provider: installation.provider,
            pulled,
            deleted: deletedExternalIds.length,
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Sync failed';
        await updateInstallationSyncCursor(installation.id, installation.sync_cursor ?? {}, undefined, message);
        return {
            provider: installation.provider,
            pulled: 0,
            deleted: 0,
            error: message,
        };
    }
}

export async function syncAllCalendarPluginsForUser(userId: string): Promise<SyncInstallationResult[]> {
    const installations = await listConnectedCalendarPluginInstallations(userId);
    const results: SyncInstallationResult[] = [];
    for (const installation of installations) {
        results.push(await syncCalendarPluginInstallation(installation));
    }
    return results;
}

export async function syncCalendarPluginForUser(
    userId: string,
    provider: CalendarPluginProvider,
): Promise<SyncInstallationResult> {
    const installation = await findCalendarPluginInstallation(userId, provider);
    if (!installation) throw new Error('Calendar plugin not connected');
    return syncCalendarPluginInstallation(installation);
}

export async function pushEventCreateToPlugins(
    userId: string,
    event: CalendarEventDTO,
    targetProviders?: CalendarPluginProvider[],
): Promise<void> {
    const installations = await listConnectedCalendarPluginInstallations(userId);
    const snapshot = toPluginEventSnapshot(event);
    for (const installation of installations) {
        if (targetProviders && !targetProviders.includes(installation.provider)) continue;
        const handler = getCalendarPluginHandler(installation.provider);
        if (!handler.capabilities.canCreateArbitraryEvents) continue;
        try {
            const created = await handler.pushCreate(installation, snapshot);
            await upsertPluginEventLink({
                eventId: event.id,
                installationId: installation.id,
                externalEventId: created.externalEventId,
                externalCalendarId: created.externalCalendarId,
                externalEtag: created.etag,
                syncOrigin: 'export',
            });
            await query(
                `UPDATE ${SCHEMA}.events
                 SET source = 'plugin',
                     source_plugin_installation_id = $1,
                     source_plugin_provider = $2
                 WHERE id = $3`,
                [installation.id, installation.provider, event.id],
            );
        } catch {
            /* best-effort multi-provider push */
        }
    }
}

export async function pushEventUpdateToPlugins(
    userId: string,
    event: CalendarEventDTO,
): Promise<void> {
    const link = await findPluginEventLinkByEventId(event.id);
    if (!link) {
        if (event.source === 'manual') {
            await pushEventCreateToPlugins(userId, event);
        }
        return;
    }

    const installation = await findCalendarPluginInstallationById(link.installation_id);
    if (!installation) return;

    if (link.sync_origin === 'import' && link.last_pulled_at) {
        const pulledAt = new Date(link.last_pulled_at).getTime();
        if (Date.now() - pulledAt < SYNC_DEBOUNCE_MS) return;
    }

    const handler = getCalendarPluginHandler(installation.provider);
    if (!handler.capabilities.canUpdateEvents) return;

    const snapshot: PluginEventSnapshot = toPluginEventSnapshot(event);
    await handler.pushUpdate(installation, link, snapshot);
    await updatePluginEventLinkSyncOrigin(link.id, 'export', { lastPushedAt: true });
}

export async function pushEventDeleteToPlugins(userId: string, eventId: string): Promise<void> {
    const link = await findPluginEventLinkByEventId(eventId);
    if (!link) return;
    const installation = await findCalendarPluginInstallationById(link.installation_id);
    if (!installation || installation.user_id !== userId) return;
    const handler = getCalendarPluginHandler(installation.provider);
    if (!handler.capabilities.canDeleteEvents) return;
    try {
        await handler.pushDelete(installation, link);
    } catch {
        /* provider may already have deleted */
    }
}

export async function syncCalendarPluginInstallationById(installationId: string): Promise<SyncInstallationResult> {
    const installation = await findCalendarPluginInstallationById(installationId);
    if (!installation) throw new Error('Installation not found');
    return syncCalendarPluginInstallation(installation);
}
