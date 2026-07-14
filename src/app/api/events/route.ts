import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { assertProjectWritable } from '@/lib/billing/quota-locks';
import { buildRecurrencePlan, CALENDAR_RECURRENCE_OPTIONS } from '@/lib/calls/recurrence';
import { getUserFromRequest, query, SCHEMA } from '@/lib/db';
import { createClient } from '@/lib/insforge/server';
import {
    type EventRow,
    assertProjectInWorkspace,
    assertWorkspaceMember,
    EVENT_WITH_CONFERENCE_SELECT,
    getCalendarInWorkspace,
    mapEventRow,
} from '@/lib/calendar/db';
import { createEventSchema, dateTimeSchema, uuidSchema } from '@/lib/calendar/schemas';
import { createProviderConference, persistEventConference, syncConferenceDelete } from '@/lib/integrations/calendar/conferences';
import { notifyEventInvitees, resolveActorDisplayName } from '@/lib/calendar/notify-event-invitees';
import { pushEventCreateToPlugins } from '@/lib/plugins/calendar/sync-engine';
import { toAccessResponse } from '@/lib/rbac/http';

function buildRecurrenceResponse(plan: {
    occurrenceCount: number;
    effectiveUntilIso: string;
    requestedUntilIso: string;
    truncatedByMax: boolean;
}) {
    return {
        occurrenceCount: plan.occurrenceCount,
        effectiveUntil: plan.effectiveUntilIso,
        requestedUntil: plan.requestedUntilIso,
        truncatedByMax: plan.truncatedByMax,
    };
}

export async function GET(request: Request) {
    const insforge = await createClient();
    const { data: { user: sessionUser } } = await insforge.auth.getUser().catch(() => ({ data: { user: null } }));
    const fallbackUser = sessionUser ? null : await getUserFromRequest(request);
    const user = sessionUser ? { id: sessionUser.id, email: sessionUser.email ?? '' } : fallbackUser;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const projectId = searchParams.get('projectId');

    const workspaceResult = workspaceId ? uuidSchema.safeParse(workspaceId) : null;
    const startResult = start ? dateTimeSchema.safeParse(start) : null;
    const endResult = end ? dateTimeSchema.safeParse(end) : null;
    const projectResult = projectId ? uuidSchema.safeParse(projectId) : null;

    if (workspaceResult && !workspaceResult.success) {
        return NextResponse.json({ error: 'Invalid workspaceId' }, { status: 400 });
    }
    if (startResult && !startResult.success) {
        return NextResponse.json({ error: 'Invalid start date' }, { status: 400 });
    }
    if (endResult && !endResult.success) {
        return NextResponse.json({ error: 'Invalid end date' }, { status: 400 });
    }
    if (startResult?.data && endResult?.data && new Date(endResult.data).getTime() <= new Date(startResult.data).getTime()) {
        return NextResponse.json({ error: 'end must be after start' }, { status: 400 });
    }
    if (projectResult && !projectResult.success) {
        return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
    }
    if (projectResult && !workspaceResult?.data) {
        return NextResponse.json({ error: 'projectId requires workspaceId' }, { status: 400 });
    }

    try {
        if (workspaceResult?.data) {
            const hasAccess = await assertWorkspaceMember(workspaceResult.data, user.id);
            if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (workspaceResult?.data && !(await assertProjectInWorkspace(projectResult?.data, workspaceResult.data))) {
            return NextResponse.json({ error: 'Project does not belong to workspace' }, { status: 400 });
        }

        const params: string[] = [user.id];
        let dateFilter = '';
        if (startResult?.data && endResult?.data) {
            params.push(startResult.data, endResult.data);
            dateFilter = `AND e.start_time < $${params.length}::timestamptz AND e.end_time > $${params.length - 1}::timestamptz`;
        }
        let visibilityFilter = 'e.account_id = $1';
        let workspaceParamIndex: number | null = null;
        if (workspaceResult?.data) {
            params.push(workspaceResult.data);
            workspaceParamIndex = params.length;
            visibilityFilter = `(
                e.account_id = $1
                OR e.workspace_id = $${workspaceParamIndex}
            )`;
        }
        let projectFilter = '';
        if (projectResult?.data) {
            params.push(projectResult.data);
            projectFilter = `AND (
                e.account_id = $1
                OR e.project_id = $${params.length}
                OR (e.workspace_id = $${workspaceParamIndex} AND e.project_id IS NULL)
            )`;
        }

        const result = await query<EventRow>(
            `SELECT ${EVENT_WITH_CONFERENCE_SELECT}
             FROM ${SCHEMA}.events e
             LEFT JOIN ${SCHEMA}.event_conferences c ON c.event_id = e.id
             WHERE ${visibilityFilter}
               AND e.status = 'confirmed'
               ${dateFilter}
               ${projectFilter}
             ORDER BY e.start_time ASC`,
            params,
        );

        return NextResponse.json({ events: result.rows.map(mapEventRow) });
    } catch (error: unknown) {
        console.error('[api/events GET]', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const insforge = await createClient();
    const { data: { user: sessionUser } } = await insforge.auth.getUser().catch(() => ({ data: { user: null } }));
    const fallbackUser = sessionUser ? null : await getUserFromRequest(request);
    const user = sessionUser ? { id: sessionUser.id, email: sessionUser.email ?? '' } : fallbackUser;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    const input = parsed.data;

    try {
        let accountId: string | null = null;
        let nextWorkspaceId: string | null = null;
        let nextCalendarId: string | null = null;
        let nextProjectId: string | null = null;

        if (input.scope !== 'account' && !input.workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required for workspace or project events' }, { status: 400 });
        }

        if (input.scope === 'account') {
            accountId = user.id;
        } else {
            if (!input.workspaceId || !input.calendarId) {
                return NextResponse.json({ error: 'workspaceId and calendarId are required' }, { status: 400 });
            }

            const hasAccess = await assertWorkspaceMember(input.workspaceId, user.id);
            if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

            const calendar = await getCalendarInWorkspace(input.calendarId, input.workspaceId);
            if (!calendar) return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });

            if (input.scope === 'project') {
                if (!(await assertProjectInWorkspace(input.projectId, input.workspaceId))) {
                    return NextResponse.json({ error: 'Project does not belong to workspace' }, { status: 400 });
                }
                await assertProjectWritable(input.projectId);
                nextProjectId = input.projectId ?? null;
            }

            nextWorkspaceId = input.workspaceId;
            nextCalendarId = input.calendarId;
        }

        const recurrenceFrequency = input.recurrenceFrequency ?? null;
        const recurrenceUntil = recurrenceFrequency ? input.recurrenceUntil ?? null : null;
        const durationMs = new Date(input.endTime).getTime() - new Date(input.startTime).getTime();
        const recurrencePlan = recurrenceFrequency && recurrenceUntil
            ? buildRecurrencePlan(input.startTime, recurrenceFrequency, recurrenceUntil, CALENDAR_RECURRENCE_OPTIONS)
            : null;
        const persistedUntil = recurrenceUntil ?? null;
        if (recurrencePlan && !recurrencePlan.startMatchesPattern) {
            return NextResponse.json(
                { error: `The start date must fall on a ${recurrenceFrequency === 'weekdays' ? 'weekday' : 'weekend'} for this repeat pattern` },
                { status: 400 },
            );
        }
        if (recurrencePlan && recurrencePlan.occurrenceCount < 2) {
            return NextResponse.json(
                { error: 'Recurring events must generate at least 2 occurrences. Choose a later series end date.' },
                { status: 400 },
            );
        }
        const occurrenceStarts = recurrencePlan?.starts ?? [input.startTime];
        const seriesId = occurrenceStarts.length > 1 ? randomUUID() : null;

        const createdEventIds: string[] = [];
        const createdConferencesForCleanup: Array<{
            event: EventRow;
            conference: NonNullable<Awaited<ReturnType<typeof createProviderConference>>>;
        }> = [];
        let firstSavedEvent: ReturnType<typeof mapEventRow> | null = null;

        try {
            for (const occurrenceStart of occurrenceStarts) {
                const occurrenceEnd = new Date(new Date(occurrenceStart).getTime() + durationMs).toISOString();

                const conference = await createProviderConference(user.id, input.conferenceProvider, {
                    title: input.title,
                    description: input.description ?? null,
                    location: input.location ?? null,
                    startTime: occurrenceStart,
                    endTime: occurrenceEnd,
                    timezone: input.timezone,
                    isAllDay: input.isAllDay ?? false,
                });

                const result = await query<EventRow>(
                    `INSERT INTO ${SCHEMA}.events
                        (calendar_id, workspace_id, account_id, project_id, created_by, source, title, description, location, start_time, end_time, timezone, is_all_day, series_id, recurrence_frequency, recurrence_until)
                     VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7, $8, $9::timestamptz, $10::timestamptz, $11, $12, $13, $14, $15)
                     RETURNING *`,
                    [
                        nextCalendarId,
                        nextWorkspaceId,
                        accountId,
                        nextProjectId,
                        user.id,
                        input.title,
                        input.description ?? null,
                        input.location ?? null,
                        occurrenceStart,
                        occurrenceEnd,
                        input.timezone,
                        input.isAllDay ?? false,
                        seriesId,
                        recurrenceFrequency,
                        persistedUntil,
                    ],
                );

                const row = result.rows[0];
                createdEventIds.push(row.id);

                if (conference) {
                    try {
                        await persistEventConference(row.id, conference);
                        createdConferencesForCleanup.push({ event: row, conference });
                    } catch (error) {
                        await syncConferenceDelete(user.id, {
                            ...mapEventRow(row),
                            conference: {
                                id: 'external',
                                eventId: row.id,
                                provider: conference.provider,
                                joinUrl: conference.joinUrl,
                                externalEventId: conference.externalEventId,
                                externalMeetingId: conference.externalMeetingId,
                                status: 'active',
                                createdAt: row.created_at,
                                updatedAt: row.updated_at,
                            },
                        });
                        throw error;
                    }
                }

                if (input.attendeeIds && input.attendeeIds.length > 0) {
                    const values = input.attendeeIds.map((_, i) => `($1, $${i + 2})`).join(', ');
                    await query(
                        `INSERT INTO ${SCHEMA}.event_attendees (event_id, user_id) VALUES ${values} ON CONFLICT DO NOTHING`,
                        [row.id, ...input.attendeeIds],
                    );
                }

                const hydrated = await query<EventRow>(
                    `SELECT ${EVENT_WITH_CONFERENCE_SELECT}
                     FROM ${SCHEMA}.events e
                     LEFT JOIN ${SCHEMA}.event_conferences c ON c.event_id = e.id
                     WHERE e.id = $1`,
                    [row.id],
                );

                const savedEvent = mapEventRow(hydrated.rows[0] ?? row);
                if (!firstSavedEvent) firstSavedEvent = savedEvent;

                if (savedEvent.scope === 'account' && savedEvent.source === 'manual') {
                    try {
                        await pushEventCreateToPlugins(user.id, savedEvent);
                    } catch {
                        /* plugin push is best-effort */
                    }
                }
            }
        } catch (error) {
            for (const { event, conference } of createdConferencesForCleanup) {
                await syncConferenceDelete(user.id, {
                    ...mapEventRow(event),
                    conference: {
                        id: 'cleanup',
                        eventId: event.id,
                        provider: conference.provider,
                        joinUrl: conference.joinUrl,
                        externalEventId: conference.externalEventId,
                        externalMeetingId: conference.externalMeetingId,
                        status: 'active',
                        createdAt: event.created_at,
                        updatedAt: event.updated_at,
                    },
                }).catch(() => {});
            }
            // Best-effort cleanup of partially-created occurrences (conferences cascade on delete).
            if (createdEventIds.length > 0) {
                await query(`DELETE FROM ${SCHEMA}.events WHERE id = ANY($1::uuid[])`, [createdEventIds]).catch(() => {});
            }
            throw error;
        }

        if (
            firstSavedEvent &&
            input.scope !== 'account' &&
            input.attendeeIds &&
            input.attendeeIds.length > 0
        ) {
            try {
                const actorName = await resolveActorDisplayName(user.id);
                await notifyEventInvitees({
                    action: 'invited',
                    event: firstSavedEvent,
                    attendeeIds: input.attendeeIds ?? [],
                    actorUserId: user.id,
                    actorName,
                    revisionKey: firstSavedEvent.updatedAt,
                });
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn('[api/events POST] invite notify failed:', message);
            }
        }

        return NextResponse.json({
            event: firstSavedEvent,
            recurrence: recurrencePlan ? buildRecurrenceResponse(recurrencePlan) : null,
        }, { status: 201 });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        console.error('[api/events POST]', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
