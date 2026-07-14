import { SCHEMA, query } from '@/lib/db';
import type { RecurrenceFrequency } from '@/lib/calls/recurrence';
import type { CalendarDTO, CalendarEventDTO } from '@/types/calendar';

export interface CalendarRow {
    id: string;
    workspace_id: string;
    created_by: string | null;
    name: string;
    color: string | null;
    timezone: string;
    is_default: boolean;
    created_at: string;
    updated_at: string;
}

export interface EventRow {
    id: string;
    calendar_id: string | null;
    workspace_id: string | null;
    account_id: string | null;
    project_id: string | null;
    created_by: string | null;
    source: 'manual' | 'email' | 'plugin';
    source_mail_account_id: string | null;
    source_message_id: string | null;
    source_plugin_installation_id: string | null;
    source_plugin_provider: string | null;
    title: string;
    description: string | null;
    location: string | null;
    start_time: string;
    end_time: string;
    timezone: string;
    is_all_day: boolean;
    status: 'confirmed' | 'cancelled';
    series_id: string | null;
    recurrence_frequency: RecurrenceFrequency | null;
    recurrence_until: string | null;
    created_at: string;
    updated_at: string;
    conference_id?: string | null;
    conference_provider?: 'google_meet' | 'zoom' | null;
    conference_join_url?: string | null;
    conference_external_event_id?: string | null;
    conference_external_meeting_id?: string | null;
    conference_status?: 'active' | 'error' | null;
    conference_created_at?: string | null;
    conference_updated_at?: string | null;
    attendee_ids?: string[] | null;
}

export const EVENT_WITH_CONFERENCE_SELECT = `
    e.*,
    c.id AS conference_id,
    c.provider AS conference_provider,
    c.join_url AS conference_join_url,
    c.external_event_id AS conference_external_event_id,
    c.external_meeting_id AS conference_external_meeting_id,
    c.status AS conference_status,
    c.created_at AS conference_created_at,
    c.updated_at AS conference_updated_at,
    COALESCE(
        (SELECT ARRAY_AGG(ea.user_id::text) FROM ${SCHEMA}.event_attendees ea WHERE ea.event_id = e.id),
        ARRAY[]::text[]
    ) AS attendee_ids
`;

export function mapCalendarRow(row: CalendarRow): CalendarDTO {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        createdBy: row.created_by,
        name: row.name,
        color: row.color,
        timezone: row.timezone,
        isDefault: row.is_default,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function mapEventRow(row: EventRow): CalendarEventDTO {
    const scope = row.project_id
        ? 'project'
        : row.workspace_id
            ? 'workspace'
            : 'account';
    return {
        id: row.id,
        calendarId: row.calendar_id,
        workspaceId: row.workspace_id,
        accountId: row.account_id,
        scope,
        projectId: row.project_id,
        createdBy: row.created_by,
        source: row.source,
        sourceMailAccountId: row.source_mail_account_id,
        sourceMessageId: row.source_message_id,
        sourcePluginInstallationId: row.source_plugin_installation_id,
        sourcePluginProvider: (row.source_plugin_provider as CalendarEventDTO['sourcePluginProvider']) ?? null,
        title: row.title,
        description: row.description,
        location: row.location,
        startTime: row.start_time,
        endTime: row.end_time,
        timezone: row.timezone,
        isAllDay: row.is_all_day,
        status: row.status,
        conference: row.conference_id && row.conference_provider && row.conference_join_url
            ? {
                id: row.conference_id,
                eventId: row.id,
                provider: row.conference_provider,
                joinUrl: row.conference_join_url,
                externalEventId: row.conference_external_event_id ?? null,
                externalMeetingId: row.conference_external_meeting_id ?? null,
                status: row.conference_status ?? 'active',
                createdAt: row.conference_created_at ?? row.created_at,
                updatedAt: row.conference_updated_at ?? row.updated_at,
            }
            : null,
        attendeeIds: row.attendee_ids ?? [],
        seriesId: row.series_id ?? null,
        recurrenceFrequency: row.recurrence_frequency ?? null,
        recurrenceUntil: row.recurrence_until ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export async function assertWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
    const result = await query<{ id: string }>(
        `SELECT w.id
         FROM ${SCHEMA}.workspaces w
         LEFT JOIN ${SCHEMA}.workspace_members wm
           ON wm.workspace_id = w.id
          AND wm.user_id = $2
         WHERE w.id = $1
           AND (w.owner_id = $2 OR wm.user_id = $2)
         LIMIT 1`,
        [workspaceId, userId],
    );
    return Boolean(result.rows[0]);
}

export async function assertProjectInWorkspace(projectId: string | null | undefined, workspaceId: string): Promise<boolean> {
    if (!projectId) return true;
    const result = await query<{ id: string }>(
        `SELECT id FROM ${SCHEMA}.projects WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
        [projectId, workspaceId],
    );
    return Boolean(result.rows[0]);
}

export async function getCalendarInWorkspace(calendarId: string, workspaceId: string): Promise<CalendarDTO | null> {
    const result = await query<CalendarRow>(
        `SELECT * FROM ${SCHEMA}.calendars WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
        [calendarId, workspaceId],
    );
    return result.rows[0] ? mapCalendarRow(result.rows[0]) : null;
}

export async function getDefaultWorkspaceCalendar(workspaceId: string): Promise<CalendarDTO | null> {
    const result = await query<CalendarRow>(
        `SELECT *
           FROM ${SCHEMA}.calendars
          WHERE workspace_id = $1
          ORDER BY is_default DESC, created_at ASC
          LIMIT 1`,
        [workspaceId],
    );
    return result.rows[0] ? mapCalendarRow(result.rows[0]) : null;
}

export async function insertManualWorkspaceEvent(params: {
    calendarId: string;
    workspaceId: string;
    projectId: string | null;
    createdBy: string;
    title: string;
    description: string | null;
    startTime: string;
    endTime: string;
    timezone: string;
}): Promise<string> {
    const result = await query<{ id: string }>(
        `INSERT INTO ${SCHEMA}.events
           (calendar_id, workspace_id, account_id, project_id, created_by, source,
            title, description, location, start_time, end_time, timezone, is_all_day)
         VALUES ($1, $2, NULL, $3, $4, 'manual', $5, $6, NULL,
                 $7::timestamptz, $8::timestamptz, $9, false)
         RETURNING id`,
        [
            params.calendarId,
            params.workspaceId,
            params.projectId,
            params.createdBy,
            params.title,
            params.description,
            params.startTime,
            params.endTime,
            params.timezone,
        ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Failed to insert calendar event');
    return id;
}

export async function getEventWithAccess(eventId: string, userId: string): Promise<CalendarEventDTO | null> {
    const result = await query<EventRow>(
        `SELECT ${EVENT_WITH_CONFERENCE_SELECT}
         FROM ${SCHEMA}.events e
         LEFT JOIN ${SCHEMA}.event_conferences c ON c.event_id = e.id
         LEFT JOIN ${SCHEMA}.workspaces w ON w.id = e.workspace_id
         LEFT JOIN ${SCHEMA}.workspace_members wm
           ON wm.workspace_id = e.workspace_id
          AND wm.user_id = $2
         WHERE e.id = $1
           AND (
             w.owner_id = $2
             OR wm.user_id = $2
             OR e.account_id = $2
           )
         LIMIT 1`,
        [eventId, userId],
    );
    return result.rows[0] ? mapEventRow(result.rows[0]) : null;
}
