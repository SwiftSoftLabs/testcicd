import type { Task } from '@/types';
import type { RecurrenceFrequency } from '@/lib/calls/recurrence';

export type { RecurrenceFrequency } from '@/lib/calls/recurrence';

export type CalendarPluginProvider = 'google_calendar' | 'outlook' | 'calendly';

export type CalendarEventSource = 'manual' | 'email' | 'plugin';
export type CalendarEventScope = 'account' | 'workspace' | 'project';
export type ConferenceProvider = 'none' | 'google_meet' | 'zoom';

export interface EventConferenceDTO {
    id: string;
    eventId: string;
    provider: Exclude<ConferenceProvider, 'none'>;
    joinUrl: string;
    externalEventId: string | null;
    externalMeetingId: string | null;
    status: 'active' | 'error';
    createdAt: string;
    updatedAt: string;
}

export interface CalendarDTO {
    id: string;
    workspaceId: string;
    createdBy: string | null;
    name: string;
    color: string | null;
    timezone: string;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CalendarEventDTO {
    id: string;
    calendarId: string | null;
    workspaceId: string | null;
    accountId: string | null;
    scope: CalendarEventScope;
    projectId: string | null;
    createdBy: string | null;
    source: CalendarEventSource;
    sourceMailAccountId: string | null;
    sourceMessageId: string | null;
    sourcePluginInstallationId: string | null;
    sourcePluginProvider: CalendarPluginProvider | null;
    title: string;
    description: string | null;
    location: string | null;
    startTime: string;
    endTime: string;
    timezone: string;
    isAllDay: boolean;
    status: 'confirmed' | 'cancelled';
    conference: EventConferenceDTO | null;
    attendeeIds: string[];
    seriesId: string | null;
    recurrenceFrequency: RecurrenceFrequency | null;
    recurrenceUntil: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface CreateCalendarInput {
    workspaceId: string;
    name: string;
    color?: string | null;
    timezone?: string;
    isDefault?: boolean;
}

export interface CreateEventInput {
    scope: CalendarEventScope;
    calendarId?: string | null;
    workspaceId?: string | null;
    projectId?: string | null;
    title: string;
    description?: string | null;
    location?: string | null;
    startTime: string;
    endTime: string;
    timezone: string;
    isAllDay?: boolean;
    conferenceProvider?: ConferenceProvider;
    attendeeIds?: string[];
    recurrenceFrequency?: RecurrenceFrequency | null;
    recurrenceUntil?: string | null;
}

export interface CreateEmailEventInput {
    mailMessageId: string;
    title?: string;
    description?: string | null;
    location?: string | null;
    startTime: string;
    endTime: string;
    timezone: string;
    isAllDay?: boolean;
    conferenceProvider?: ConferenceProvider;
}

export interface UpdateEventInput {
    scope?: CalendarEventScope;
    source?: CalendarEventSource;
    calendarId?: string;
    workspaceId?: string | null;
    projectId?: string | null;
    title?: string;
    description?: string | null;
    location?: string | null;
    startTime?: string;
    endTime?: string;
    timezone?: string;
    isAllDay?: boolean;
    status?: 'confirmed' | 'cancelled';
    conferenceProvider?: ConferenceProvider;
    attendeeIds?: string[];
    applyToSeries?: boolean;
    seriesUpdateScope?: 'following' | 'series';
    seriesRecurrenceUntil?: string | null;
}

export interface EventRecurrenceSummaryDTO {
    occurrenceCount: number;
    effectiveUntil: string;
    requestedUntil: string;
    truncatedByMax: boolean;
}

export type CalendarDisplayItem =
    | {
        source: 'event';
        id: string;
        title: string;
        description: string | null;
        projectId: string | null;
        accountId: string | null;
        eventScope: CalendarEventScope;
        eventSource: CalendarEventSource;
        sourceMailAccountId: string | null;
        sourceMessageId: string | null;
        start: Date;
        end: Date;
        day: number;
        month: number;
        year: number;
        isAllDay: boolean;
        color: string | null;
        event: CalendarEventDTO;
    }
    | {
        source: 'task';
        id: string;
        title: string;
        description: string | null;
        projectId: string | null;
        start: Date;
        end: Date;
        day: number;
        month: number;
        year: number;
        isAllDay: true;
        color: string | null;
        task: Task;
    };
