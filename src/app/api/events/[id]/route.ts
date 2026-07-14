import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
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
    getEventWithAccess,
    mapEventRow,
} from '@/lib/calendar/db';
import { updateEventSchema } from '@/lib/calendar/schemas';
import {
    createProviderConference,
    deletePersistedConference,
    persistEventConference,
    syncConferenceDelete,
    syncConferenceUpdate,
} from '@/lib/integrations/calendar/conferences';
import {
    dispatchDeleteEventInviteNotifications,
    dispatchPatchEventInviteNotifications,
} from '@/lib/calendar/notify-event-invitees';
import { getProviderCapabilities } from '@/lib/plugins/calendar/registry';
import { pushEventCreateToPlugins, pushEventDeleteToPlugins, pushEventUpdateToPlugins } from '@/lib/plugins/calendar/sync-engine';
import { toAccessResponse } from '@/lib/rbac/http';
import type { CalendarEventDTO } from '@/types/calendar';

async function getSeriesTargets(
    seriesId: string,
    anchor: Pick<CalendarEventDTO, 'workspaceId' | 'accountId'>,
): Promise<CalendarEventDTO[]> {
    const siblings = await query<EventRow>(
        `SELECT ${EVENT_WITH_CONFERENCE_SELECT}
         FROM ${SCHEMA}.events e
         LEFT JOIN ${SCHEMA}.event_conferences c ON c.event_id = e.id
         WHERE e.series_id = $1
           AND (
             ($2::uuid IS NOT NULL AND e.workspace_id = $2::uuid)
             OR ($3::uuid IS NOT NULL AND e.account_id = $3::uuid)
           )
         ORDER BY e.start_time ASC`,
        [seriesId, anchor.workspaceId ?? null, anchor.accountId ?? null],
    );
    return siblings.rows.map(mapEventRow);
}

async function hydrateEvent(eventId: string): Promise<CalendarEventDTO | null> {
    const hydrated = await query<EventRow>(
        `SELECT ${EVENT_WITH_CONFERENCE_SELECT}
         FROM ${SCHEMA}.events e
         LEFT JOIN ${SCHEMA}.event_conferences c ON c.event_id = e.id
         WHERE e.id = $1`,
        [eventId],
    );
    if (!hydrated.rows[0]) return null;
    return mapEventRow(hydrated.rows[0]);
}

async function replaceEventAttendees(eventId: string, attendeeIds: string[] | undefined): Promise<void> {
    if (attendeeIds === undefined) return;
    if (attendeeIds.length > 0) {
        await query(
            `WITH deleted AS (DELETE FROM ${SCHEMA}.event_attendees WHERE event_id = $1)
             INSERT INTO ${SCHEMA}.event_attendees (event_id, user_id)
             SELECT $1, unnest($2::uuid[])
             ON CONFLICT DO NOTHING`,
            [eventId, attendeeIds],
        );
        return;
    }
    await query(`DELETE FROM ${SCHEMA}.event_attendees WHERE event_id = $1`, [eventId]);
}

async function updateSeriesTailMetadata(
    targets: CalendarEventDTO[],
    recurrenceUntil: string,
): Promise<void> {
    if (targets.length === 0) return;
    await query(
        `UPDATE ${SCHEMA}.events
         SET recurrence_until = $2,
             updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [targets.map((target) => target.id), recurrenceUntil],
    );
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const insforge = await createClient();
    const { data: { user: sessionUser } } = await insforge.auth.getUser().catch(() => ({ data: { user: null } }));
    const fallbackUser = sessionUser ? null : await getUserFromRequest(request);
    const user = sessionUser ? { id: sessionUser.id, email: sessionUser.email ?? '' } : fallbackUser;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    try {
        const event = await getEventWithAccess(id, user.id);
        if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
        return NextResponse.json({ event });
    } catch (error: unknown) {
        console.error('[api/events/[id] GET]', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const insforge = await createClient();
    const { data: { user: sessionUser } } = await insforge.auth.getUser().catch(() => ({ data: { user: null } }));
    const fallbackUser = sessionUser ? null : await getUserFromRequest(request);
    const user = sessionUser ? { id: sessionUser.id, email: sessionUser.email ?? '' } : fallbackUser;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = updateEventSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    try {
        const existing = await getEventWithAccess(id, user.id);
        if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
        await assertProjectWritable(existing.projectId);

        const input = parsed.data;
        const nextStart = input.startTime ?? existing.startTime;
        const nextEnd = input.endTime ?? existing.endTime;
        const nextScope = input.scope ?? existing.scope;
        const nextSource = input.source ?? existing.source;
        if (new Date(nextEnd).getTime() <= new Date(nextStart).getTime()) {
            return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 });
        }

        if (nextSource === 'email' && existing.source !== 'email') {
            return NextResponse.json({ error: 'Manual events cannot be linked back to email' }, { status: 400 });
        }

        if (nextSource === 'email' && nextScope !== 'account') {
            return NextResponse.json({ error: 'Email-linked events must stay private' }, { status: 400 });
        }

        if (existing.source === 'plugin' && nextScope !== 'account') {
            return NextResponse.json({ error: 'Plugin-synced events must stay private' }, { status: 400 });
        }

        if (existing.source === 'plugin' && existing.sourcePluginProvider) {
            const caps = getProviderCapabilities(existing.sourcePluginProvider);
            if (!caps.canUpdateEvents) {
                return NextResponse.json(
                    { error: 'This Calendly booking cannot be edited in OneWork. Update it in Calendly.' },
                    { status: 400 },
                );
            }
        }

        if (nextScope !== 'account' && !(input.workspaceId ?? existing.workspaceId)) {
            return NextResponse.json({ error: 'workspaceId is required for workspace or project events' }, { status: 400 });
        }

        let nextAccountId: string | null = existing.accountId;
        let nextWorkspaceId: string | null = existing.workspaceId;
        let nextCalendarId: string | null = existing.calendarId;
        let nextProjectId: string | null = existing.projectId;
        let nextSourceMailAccountId: string | null = nextSource === 'email' ? existing.sourceMailAccountId : null;
        let nextSourceMessageId: string | null = nextSource === 'email' ? existing.sourceMessageId : null;

        if (nextScope === 'account') {
            nextAccountId = existing.accountId ?? user.id;
            nextWorkspaceId = null;
            nextCalendarId = null;
            nextProjectId = null;
        } else {
            const candidateWorkspaceId = input.workspaceId ?? existing.workspaceId;
            if (!candidateWorkspaceId) {
                return NextResponse.json({ error: 'workspaceId is required for workspace or project events' }, { status: 400 });
            }

            const hasAccess = await assertWorkspaceMember(candidateWorkspaceId, user.id);
            if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

            const candidateCalendarId = input.calendarId ?? existing.calendarId;
            if (!candidateCalendarId) {
                return NextResponse.json({ error: 'calendarId is required for workspace or project events' }, { status: 400 });
            }

            const calendar = await getCalendarInWorkspace(candidateCalendarId, candidateWorkspaceId);
            if (!calendar) return NextResponse.json({ error: 'Calendar not found' }, { status: 404 });

            nextAccountId = null;
            nextWorkspaceId = candidateWorkspaceId;
            nextCalendarId = candidateCalendarId;

            if (nextScope === 'project') {
                const candidateProjectId = 'projectId' in input ? input.projectId ?? null : existing.projectId;
                if (!candidateProjectId) {
                    return NextResponse.json({ error: 'projectId is required for project events' }, { status: 400 });
                }
                if (!(await assertProjectInWorkspace(candidateProjectId, candidateWorkspaceId))) {
                    return NextResponse.json({ error: 'Project does not belong to workspace' }, { status: 400 });
                }
                await assertProjectWritable(candidateProjectId);
                nextProjectId = candidateProjectId;
            } else {
                nextProjectId = null;
            }
        }

        const nextTitle = input.title ?? existing.title;
        const nextDescription = 'description' in input ? input.description ?? null : existing.description;
        const seriesUpdateScope = input.seriesUpdateScope ?? (input.applyToSeries === true ? 'series' : null);
        const applyToSeries = Boolean(seriesUpdateScope) && Boolean(existing.seriesId);
        let nextLocation = 'location' in input ? input.location ?? null : existing.location;
        if (
            applyToSeries &&
            existing.seriesId &&
            'location' in input &&
            !input.location?.trim()
        ) {
            const seriesTargetsForLocation = await getSeriesTargets(existing.seriesId, existing);
            const seriesLocation = seriesTargetsForLocation.find((target) => target.location?.trim())?.location?.trim();
            if (seriesLocation && !existing.location?.trim()) {
                nextLocation = seriesLocation;
            }
        }
        const nextTimezone = input.timezone ?? existing.timezone;
        const nextIsAllDay = input.isAllDay ?? existing.isAllDay;
        const nextStatus = input.status ?? existing.status;
        const startDeltaMs = new Date(nextStart).getTime() - new Date(existing.startTime).getTime();
        const durationMs = new Date(nextEnd).getTime() - new Date(nextStart).getTime();

        if (input.seriesRecurrenceUntil && !applyToSeries) {
            return NextResponse.json(
                { error: 'Series end changes can only be applied to the entire series.' },
                { status: 400 },
            );
        }

        let primarySaved: CalendarEventDTO | null = null;
        const seriesFrequency = existing.recurrenceFrequency;
        const currentSeriesUntil = existing.recurrenceUntil;

        if (applyToSeries && existing.seriesId && seriesFrequency && currentSeriesUntil) {
            const allSeriesTargets = await getSeriesTargets(existing.seriesId, existing);
            for (const pid of new Set(allSeriesTargets.map(t => t.projectId).filter((p): p is string => !!p && p !== existing.projectId))) {
                await assertProjectWritable(pid);
            }
            const selectedIndex = Math.max(allSeriesTargets.findIndex((target) => target.id === id), 0);
            const isFollowingScope = seriesUpdateScope === 'following';
            const priorTargets = isFollowingScope ? allSeriesTargets.slice(0, selectedIndex) : [];
            const targets = isFollowingScope ? allSeriesTargets.slice(selectedIndex) : allSeriesTargets;
            const firstTarget = targets[0] ?? existing;
            const nextSeriesUntil = input.seriesRecurrenceUntil ?? currentSeriesUntil;
            const anchorStart = new Date(new Date(firstTarget.startTime).getTime() + startDeltaMs).toISOString();
            const plan = buildRecurrencePlan(anchorStart, seriesFrequency, nextSeriesUntil, CALENDAR_RECURRENCE_OPTIONS);
            if (!plan.startMatchesPattern) {
                return NextResponse.json(
                    { error: `The start date must fall on a ${seriesFrequency === 'weekdays' ? 'weekday' : 'weekend'} for this repeat pattern` },
                    { status: 400 },
                );
            }
            if (plan.occurrenceCount < 2) {
                return NextResponse.json(
                    { error: 'Recurring events must keep at least 2 occurrences. Choose a later series end date.' },
                    { status: 400 },
                );
            }
            const nextSeriesId = isFollowingScope && priorTargets.length > 0
                ? randomUUID()
                : existing.seriesId;
            const persistedSeriesUntil = nextSeriesUntil;

            if (isFollowingScope && priorTargets.length > 0) {
                const priorUntil = priorTargets[priorTargets.length - 1]?.endTime ?? priorTargets[priorTargets.length - 1]?.startTime;
                if (priorUntil) {
                    await updateSeriesTailMetadata(priorTargets, priorUntil);
                }
            }

            const retainedCount = Math.min(targets.length, plan.starts.length);
            const nextConferenceProvider = input.conferenceProvider ?? existing.conference?.provider ?? 'none';

            // NOTE(#4): Series PATCH is non-atomic. InsForge rawsql HTTP bridge does not
            // support multi-statement transactions across calls. Update-then-insert-then-delete
            // ordering minimizes orphaned state on mid-flight failure.
            for (let index = 0; index < retainedCount; index += 1) {
                const target = targets[index];
                const targetNextStart = plan.starts[index];
                const targetNextEnd = new Date(new Date(targetNextStart).getTime() + durationMs).toISOString();
                const snapshot = {
                    title: nextTitle,
                    description: nextDescription,
                    location: nextLocation,
                    startTime: targetNextStart,
                    endTime: targetNextEnd,
                    timezone: nextTimezone,
                    isAllDay: nextIsAllDay,
                };

                const conferenceChange = await syncConferenceUpdate(
                    user.id,
                    target,
                    input.conferenceProvider,
                    snapshot,
                );

                await query<EventRow>(
                    `UPDATE ${SCHEMA}.events
                     SET calendar_id = $1,
                         workspace_id = $2,
                         account_id = $3,
                         project_id = $4,
                         source = $5,
                         source_mail_account_id = $6,
                         source_message_id = $7,
                         title = $8,
                         description = $9,
                         location = $10,
                         start_time = $11::timestamptz,
                         end_time = $12::timestamptz,
                         timezone = $13,
                         is_all_day = $14,
                         status = $15,
                         series_id = $16,
                         recurrence_frequency = $17,
                         recurrence_until = $18,
                         updated_at = NOW()
                     WHERE id = $19`,
                    [
                        nextCalendarId,
                        nextWorkspaceId,
                        nextAccountId,
                        nextProjectId,
                        nextSource,
                        nextSourceMailAccountId,
                        nextSourceMessageId,
                        nextTitle,
                        nextDescription,
                        nextLocation,
                        targetNextStart,
                        targetNextEnd,
                        nextTimezone,
                        nextIsAllDay,
                        nextStatus,
                        nextSeriesId,
                        seriesFrequency,
                        persistedSeriesUntil,
                        target.id,
                    ],
                );

                if (conferenceChange === null) {
                    await deletePersistedConference(target.id);
                } else if (conferenceChange) {
                    await persistEventConference(target.id, conferenceChange);
                }

                await replaceEventAttendees(target.id, input.attendeeIds);

                const savedEvent = await hydrateEvent(target.id);
                if (!savedEvent) {
                    console.warn('[api/events/[id] PATCH] updated series event missing during hydration', { eventId: target.id });
                    continue;
                }
                try {
                    await pushEventUpdateToPlugins(user.id, savedEvent);
                } catch {
                    /* plugin push is best-effort */
                }

                if (target.id === id) primarySaved = savedEvent;
            }

            for (let index = retainedCount; index < plan.starts.length; index += 1) {
                const targetNextStart = plan.starts[index];
                const targetNextEnd = new Date(new Date(targetNextStart).getTime() + durationMs).toISOString();
                const conference = await createProviderConference(user.id, nextConferenceProvider, {
                    title: nextTitle,
                    description: nextDescription,
                    location: nextLocation,
                    startTime: targetNextStart,
                    endTime: targetNextEnd,
                    timezone: nextTimezone,
                    isAllDay: nextIsAllDay,
                });

                const result = await query<EventRow>(
                    `INSERT INTO ${SCHEMA}.events
                        (calendar_id, workspace_id, account_id, project_id, created_by, source, source_mail_account_id, source_message_id,
                         title, description, location, start_time, end_time, timezone, is_all_day, status, series_id, recurrence_frequency, recurrence_until)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13::timestamptz, $14, $15, $16, $17, $18, $19)
                     RETURNING *`,
                    [
                        nextCalendarId,
                        nextWorkspaceId,
                        nextAccountId,
                        nextProjectId,
                        existing.createdBy ?? user.id,
                        nextSource,
                        nextSourceMailAccountId,
                        nextSourceMessageId,
                        nextTitle,
                        nextDescription,
                        nextLocation,
                        targetNextStart,
                        targetNextEnd,
                        nextTimezone,
                        nextIsAllDay,
                        nextStatus,
                        nextSeriesId,
                        seriesFrequency,
                        persistedSeriesUntil,
                    ],
                );

                const row = result.rows[0];
                if (conference) {
                    await persistEventConference(row.id, conference);
                }
                await replaceEventAttendees(row.id, input.attendeeIds ?? existing.attendeeIds);

                const savedEvent = await hydrateEvent(row.id);
                if (!savedEvent) continue;
                try {
                    await pushEventCreateToPlugins(user.id, savedEvent);
                } catch {
                    /* plugin push is best-effort */
                }
            }

            for (let index = plan.starts.length; index < targets.length; index += 1) {
                const target = targets[index];
                await syncConferenceDelete(user.id, target);
                try {
                    await pushEventDeleteToPlugins(user.id, target.id);
                } catch {
                    /* plugin push is best-effort */
                }
                await query(`DELETE FROM ${SCHEMA}.events WHERE id = $1`, [target.id]);
            }

            const savedForNotify = primarySaved
                ?? (retainedCount > 0 ? await hydrateEvent(targets[0]?.id ?? '') : null);
            if (!savedForNotify) {
                return NextResponse.json({ error: 'Event not found' }, { status: 404 });
            }
            void dispatchPatchEventInviteNotifications(existing, savedForNotify, input, user.id).catch(
                (error: unknown) => {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn('[api/events/[id] PATCH] series invite notify failed:', message);
                },
            );
            return NextResponse.json({ event: savedForNotify });
        }

        const snapshot = {
            title: nextTitle,
            description: nextDescription,
            location: nextLocation,
            startTime: nextStart,
            endTime: nextEnd,
            timezone: nextTimezone,
            isAllDay: nextIsAllDay,
        };

        const conferenceChange = await syncConferenceUpdate(
            user.id,
            existing,
            input.conferenceProvider,
            snapshot,
        );

        await query<EventRow>(
            `UPDATE ${SCHEMA}.events
             SET calendar_id = $1,
                 workspace_id = $2,
                 account_id = $3,
                 project_id = $4,
                 source = $5,
                 source_mail_account_id = $6,
                 source_message_id = $7,
                 title = $8,
                 description = $9,
                 location = $10,
                 start_time = $11::timestamptz,
                 end_time = $12::timestamptz,
                 timezone = $13,
                 is_all_day = $14,
                 status = $15,
                 updated_at = NOW()
             WHERE id = $16`,
            [
                nextCalendarId,
                nextWorkspaceId,
                nextAccountId,
                nextProjectId,
                nextSource,
                nextSourceMailAccountId,
                nextSourceMessageId,
                nextTitle,
                nextDescription,
                nextLocation,
                nextStart,
                nextEnd,
                nextTimezone,
                nextIsAllDay,
                nextStatus,
                id,
            ],
        );

        if (conferenceChange === null) {
            await deletePersistedConference(id);
        } else if (conferenceChange) {
            await persistEventConference(id, conferenceChange);
        }

        await replaceEventAttendees(id, input.attendeeIds);

        primarySaved = await hydrateEvent(id);
        if (!primarySaved) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
        try {
            await pushEventUpdateToPlugins(user.id, primarySaved);
        } catch {
            /* plugin push is best-effort */
        }

        void dispatchPatchEventInviteNotifications(existing, primarySaved, input, user.id).catch(
            (error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                console.warn('[api/events/[id] PATCH] invite notify failed:', message);
            },
        );

        return NextResponse.json({ event: primarySaved });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        console.error('[api/events/[id] PATCH]', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const insforge = await createClient();
    const { data: { user: sessionUser } } = await insforge.auth.getUser().catch(() => ({ data: { user: null } }));
    const fallbackUser = sessionUser ? null : await getUserFromRequest(request);
    const user = sessionUser ? { id: sessionUser.id, email: sessionUser.email ?? '' } : fallbackUser;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const deleteSeries = searchParams.get('scope') === 'series';
    const deleteFollowing = searchParams.get('scope') === 'following';

    try {
        const existing = await getEventWithAccess(id, user.id);
        if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
        await assertProjectWritable(existing.projectId);

        let targets: CalendarEventDTO[] = [existing];
        if ((deleteSeries || deleteFollowing) && existing.seriesId) {
            const siblings = await getSeriesTargets(existing.seriesId, existing);
            for (const pid of new Set(siblings.map(s => s.projectId).filter((p): p is string => !!p && p !== existing.projectId))) {
                await assertProjectWritable(pid);
            }
            if (siblings.length > 0) {
                if (deleteFollowing) {
                    const selectedIndex = Math.max(siblings.findIndex((target) => target.id === id), 0);
                    const priorTargets = siblings.slice(0, selectedIndex);
                    targets = siblings.slice(selectedIndex);
                    if (priorTargets.length > 0) {
                        const priorUntil = priorTargets[priorTargets.length - 1]?.endTime ?? priorTargets[priorTargets.length - 1]?.startTime;
                        if (priorUntil) {
                            await updateSeriesTailMetadata(priorTargets, priorUntil);
                        }
                    }
                } else {
                    targets = siblings;
                }
            }
        }

        try {
            await dispatchDeleteEventInviteNotifications(targets, user.id);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('[api/events/[id] DELETE] invite notify failed:', message);
        }

        for (const target of targets) {
            await syncConferenceDelete(user.id, target);
            try {
                await pushEventDeleteToPlugins(user.id, target.id);
            } catch {
                /* plugin push is best-effort */
            }
            await query(`DELETE FROM ${SCHEMA}.events WHERE id = $1`, [target.id]);
        }
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        console.error('[api/events/[id] DELETE]', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
