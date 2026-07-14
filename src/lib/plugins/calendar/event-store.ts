import { query, SCHEMA } from '@/lib/db';
import { type EventRow, mapEventRow } from '@/lib/calendar/db';
import type { CalendarEventDTO } from '@/types/calendar';
import { findPluginEventLink, upsertPluginEventLink } from './repository';
import type { CalendarPluginInstallationRow, NormalizedPluginEvent } from './types';

export async function upsertPluginCalendarEvent(
    installation: CalendarPluginInstallationRow,
    normalized: NormalizedPluginEvent,
): Promise<CalendarEventDTO> {
    const existingLink = await findPluginEventLink(installation.id, normalized.externalEventId);

    if (existingLink) {
        const externalUpdated = normalized.externalUpdatedAt
            ? new Date(normalized.externalUpdatedAt).getTime()
            : 0;
        const linkUpdated = existingLink.external_updated_at
            ? new Date(existingLink.external_updated_at).getTime()
            : 0;
        if (externalUpdated && linkUpdated && externalUpdated <= linkUpdated && existingLink.sync_origin === 'export') {
            const current = await query<EventRow>(
                `SELECT * FROM ${SCHEMA}.events WHERE id = $1 LIMIT 1`,
                [existingLink.event_id],
            );
            if (current.rows[0]) return mapEventRow(current.rows[0]);
        }

        const result = await query<EventRow>(
            `UPDATE ${SCHEMA}.events
             SET title = $1,
                 description = $2,
                 location = $3,
                 start_time = $4::timestamptz,
                 end_time = $5::timestamptz,
                 timezone = $6,
                 is_all_day = $7,
                 status = $8,
                 updated_at = NOW()
             WHERE id = $9
             RETURNING *`,
            [
                normalized.title,
                normalized.description,
                normalized.location,
                normalized.startTime,
                normalized.endTime,
                normalized.timezone,
                normalized.isAllDay,
                normalized.status,
                existingLink.event_id,
            ],
        );
        await upsertPluginEventLink({
            eventId: existingLink.event_id,
            installationId: installation.id,
            externalEventId: normalized.externalEventId,
            externalCalendarId: normalized.externalCalendarId,
            externalUpdatedAt: normalized.externalUpdatedAt,
            externalEtag: normalized.externalEtag,
            syncOrigin: 'import',
            metadata: normalized.metadata,
        });
        const row = result.rows[0];
        if (!row) throw new Error('Failed to update plugin event');
        return mapEventRow(row);
    }

    const result = await query<EventRow>(
        `INSERT INTO ${SCHEMA}.events (
            calendar_id, workspace_id, account_id, project_id, created_by,
            source, source_plugin_installation_id, source_plugin_provider,
            title, description, location, start_time, end_time, timezone, is_all_day, status
         ) VALUES (
            NULL, NULL, $1, NULL, $1,
            'plugin', $2, $3,
            $4, $5, $6, $7::timestamptz, $8::timestamptz, $9, $10, $11
         )
         RETURNING *`,
        [
            installation.user_id,
            installation.id,
            installation.provider,
            normalized.title,
            normalized.description,
            normalized.location,
            normalized.startTime,
            normalized.endTime,
            normalized.timezone,
            normalized.isAllDay,
            normalized.status,
        ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Failed to create plugin event');

    await upsertPluginEventLink({
        eventId: row.id,
        installationId: installation.id,
        externalEventId: normalized.externalEventId,
        externalCalendarId: normalized.externalCalendarId,
        externalUpdatedAt: normalized.externalUpdatedAt,
        externalEtag: normalized.externalEtag,
        syncOrigin: 'import',
        metadata: normalized.metadata,
    });

    return mapEventRow(row);
}

export async function cancelOrDeletePluginEventByExternalId(
    installationId: string,
    externalEventId: string,
): Promise<void> {
    const link = await findPluginEventLink(installationId, externalEventId);
    if (!link) return;
    await query(
        `UPDATE ${SCHEMA}.events SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [link.event_id],
    );
}
