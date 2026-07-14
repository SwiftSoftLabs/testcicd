'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useUIContext } from '@/context/UIContext';
import { getProviderCapabilities } from '@/lib/plugins/calendar/registry';
import { calendarPluginIconId } from '@/lib/plugins/plugin-icons';
import { useAppContext } from '@/context/AppContext';
import { EmailIcon, GlobeIcon, PersonIcon } from '@/components/calendar/CalendarIcons';
import { PluginIcon } from '@/components/plugins/PluginIcon';
import PresenceDot from '@/components/PresenceDot';
import { presenceFromMemberStatus } from '@/lib/presence';
import { EventDatePicker } from '@/components/calendar/EventDatePicker';
import { buildRecurrenceDescriptionNote, buildRecurrencePlan, CALENDAR_RECURRENCE_OPTIONS, recurrenceFrequencyLabel, recurrenceStartMatchesPattern, recurrenceUntilFromDateLocal, type RecurrenceFrequency } from '@/lib/calls/recurrence';
import {
    addMinutesToDateTimeLocal,
    combineDateAndTime,
    EVENT_DURATION_OPTIONS,
    formatDateLabel,
    formatTimeLabel,
    fromDateTimeLocal,
    inferDurationPreset,
    normalizeInputValue,
    splitDateTimeLocal,
    toDateLocal,
    type EventDurationPreset,
} from '@/lib/calendar/event-scheduling';
import type { CalendarDTO, CalendarEventDTO, CalendarEventScope, ConferenceProvider, CreateEmailEventInput, CreateEventInput, UpdateEventInput } from '@/types/calendar';
import type { Project } from '@/types';

const CALENDAR_OAUTH_MSG_SOURCE = 'onework-calendar-oauth';
const RECURRENCE_OPTIONS: Array<{ value: 'none' | RecurrenceFrequency; label: string; hint?: string }> = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekdays', label: 'Weekdays', hint: 'Mon-Fri' },
    { value: 'weekends', label: 'Weekends', hint: 'Sat-Sun' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
];

type SeriesScope = 'single' | 'following' | 'series';

interface EventModalProps {
    onClose: () => void;
    calendars: CalendarDTO[];
    projects: Project[];
    workspaceId?: string | null;
    event?: CalendarEventDTO;
    initialStart?: string;
    initialEnd?: string;
    initialTitle?: string;
    initialDescription?: string | null;
    initialLocation?: string | null;
    initialTimezone?: string | null;
    initialIsAllDay?: boolean;
    initialProjectId?: string | null;
    mailMessageId?: string;
    emailPreview?: { subject: string; from: string; date: string };
    onSaved?: () => void;
    readOnly?: boolean;
}

function meetingLinkLabel(provider: CalendarEventDTO['conference'] extends infer T ? T extends { provider: infer P } ? P : never : never): string {
    if (provider === 'google_meet') return 'Join Google Meet';
    if (provider === 'zoom') return 'Join Zoom Meeting';
    return 'Open meeting link';
}

function meetingLinkIcon(provider: CalendarEventDTO['conference'] extends infer T ? T extends { provider: infer P } ? P : never : never): string {
    if (provider === 'google_meet') return 'duo';
    if (provider === 'zoom') return 'video_call';
    return 'link';
}

export const EventModal: React.FC<EventModalProps> = ({
    onClose,
    calendars,
    projects,
    workspaceId,
    event,
    initialStart,
    initialEnd,
    initialTitle,
    initialDescription,
    initialLocation,
    initialTimezone,
    initialIsAllDay,
    initialProjectId,
    mailMessageId,
    emailPreview,
    onSaved,
    readOnly = false,
}) => {
    const modalRef = useRef<HTMLDivElement>(null);
    const projectPickerRef = useRef<HTMLDivElement>(null);
    const attendeePickerRef = useRef<HTMLDivElement>(null);
    const { addToast } = useUIContext();
    const { users, nativeEvents } = useAppContext();
    const isEditing = Boolean(event);
    const isPersistedEmailEvent = event?.source === 'email';
    const isPersistedPluginEvent = event?.source === 'plugin';
    const pluginProvider = event?.sourcePluginProvider ?? null;
    const pluginCaps = pluginProvider ? getProviderCapabilities(pluginProvider) : null;
    const pluginProviderLabel =
        pluginProvider === 'google_calendar'
            ? 'Google Calendar'
            : pluginProvider === 'outlook'
                ? 'Microsoft Outlook'
                : pluginProvider === 'calendly'
                    ? 'Calendly'
                    : 'Plugin';
    const isCreatingFromEmail = Boolean(mailMessageId) && !event;
    const defaultCalendar = calendars.find((calendar) => calendar.isDefault) ?? calendars[0];
    const canUseWorkspaceScopes = Boolean(workspaceId);
    const hasMultipleWorkspaceCalendars = calendars.length > 1;
    const initialAllDay = event?.isAllDay ?? initialIsAllDay ?? false;
    const timezone = useMemo(
        () =>
            event?.timezone ??
            initialTimezone ??
            defaultCalendar?.timezone ??
            Intl.DateTimeFormat().resolvedOptions().timeZone ??
            'Asia/Manila',
        [defaultCalendar?.timezone, event?.timezone, initialTimezone],
    );
    const initialProjectValue = event
        ? (event.projectId ?? '')
        : (initialProjectId ?? '');
    const initialScope = event?.scope ?? (workspaceId ? (initialProjectId ? 'project' : 'workspace') : 'account');

    const resolvedInitialLocation = useMemo(() => {
        if (event?.location?.trim()) return event.location.trim();
        if (initialLocation?.trim()) return initialLocation.trim();
        if (!event?.seriesId) return '';
        const fromSeries = nativeEvents.find(
            (candidate) =>
                candidate.seriesId === event.seriesId &&
                candidate.id !== event.id &&
                candidate.location?.trim(),
        );
        return fromSeries?.location?.trim() ?? '';
    }, [event, initialLocation, nativeEvents]);

    const [title, setTitle] = useState(event?.title ?? initialTitle ?? '');
    const [description, setDescription] = useState(event?.description ?? initialDescription ?? '');
    const [location, setLocation] = useState(resolvedInitialLocation);
    useEffect(() => {
        if (!resolvedInitialLocation) return;
        setLocation((current) => (current.trim() ? current : resolvedInitialLocation));
    }, [resolvedInitialLocation]);
    useEffect(() => {
        if (!event?.id) return;
        let cancelled = false;
        void api.events.get(event.id).then((response) => {
            if (cancelled) return;
            const fresh = response.event;
            if (fresh.location?.trim()) {
                setLocation(fresh.location.trim());
            } else {
                const fromSeries = nativeEvents.find(
                    (candidate) =>
                        candidate.seriesId === fresh.seriesId &&
                        candidate.id !== fresh.id &&
                        candidate.location?.trim(),
                );
                if (fromSeries?.location?.trim()) {
                    setLocation(fromSeries.location.trim());
                }
            }
        }).catch(() => {
            /* keep list payload */
        });
        return () => {
            cancelled = true;
        };
    }, [event?.id, event?.location, nativeEvents]);
    const [calendarId, setCalendarId] = useState(event?.calendarId ?? defaultCalendar?.id ?? '');
    const [projectId, setProjectId] = useState(initialProjectValue);
    const [isShared, setIsShared] = useState(initialScope !== 'account');
    const [linkToEmail, setLinkToEmail] = useState(Boolean(mailMessageId) || isPersistedEmailEvent);
    const initialStartNormalized = normalizeInputValue(event?.startTime ?? initialStart ?? '', initialAllDay);
    const initialEndNormalized = normalizeInputValue(
        event?.endTime ?? initialEnd ?? event?.startTime ?? initialStart ?? '',
        initialAllDay,
    );
    const initialStartParts = splitDateTimeLocal(initialStartNormalized);
    const initialEndParts = splitDateTimeLocal(initialEndNormalized);
    const [startDate, setStartDate] = useState(initialStartParts.date);
    const [startClock, setStartClock] = useState(initialStartParts.time);
    const [endDate, setEndDate] = useState(initialEndParts.date);
    const [endClock, setEndClock] = useState(initialEndParts.time);
    const [durationPreset, setDurationPreset] = useState<EventDurationPreset>(() =>
        inferDurationPreset(initialStartNormalized, initialEndNormalized, initialAllDay),
    );
    const [isAllDay, setIsAllDay] = useState(initialAllDay);
    const [conferenceProvider, setConferenceProvider] = useState<ConferenceProvider>(event?.conference?.provider ?? 'none');
    const [integrationStatus, setIntegrationStatus] = useState<{
        googleConfigured: boolean;
        zoomConfigured: boolean;
        googleConnected: boolean;
        zoomConnected: boolean;
        googleAccount: string | null;
        zoomAccount: string | null;
    }>({
        googleConfigured: false,
        zoomConfigured: false,
        googleConnected: false,
        zoomConnected: false,
        googleAccount: null,
        zoomAccount: null,
    });
    const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
    const [isAttendeePickerOpen, setIsAttendeePickerOpen] = useState(false);
    const [attendeeIds, setAttendeeIds] = useState<string[]>(event?.attendeeIds ?? []);
    const [isChangingConference, setIsChangingConference] = useState(false);
    const [recurrence, setRecurrence] = useState<'one_time' | 'recurring'>('one_time');
    const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>('weekly');
    const [recurrenceUntilDate, setRecurrenceUntilDate] = useState('');
    const [seriesScope, setSeriesScope] = useState<SeriesScope>('single');
    const [seriesRecurrenceUntilDate, setSeriesRecurrenceUntilDate] = useState(toDateLocal(event?.recurrenceUntil ?? ''));
    const isSeriesEvent = Boolean(event?.seriesId);
    const showRecurrenceOptions = !event && !linkToEmail;
    const isRecurring = showRecurrenceOptions && recurrence === 'recurring';
    const isEditingFutureSeries = isSeriesEvent && seriesScope === 'following';
    const isEditingEntireSeries = isSeriesEvent && seriesScope === 'series';
    const isEditingSeriesRange = isEditingFutureSeries || isEditingEntireSeries;
    const visibilityMode = linkToEmail
        ? 'email'
        : canUseWorkspaceScopes && isShared
            ? 'workspace'
            : 'private';

    const effectiveScope: CalendarEventScope =
        visibilityMode === 'email' || !canUseWorkspaceScopes || !isShared
            ? 'account'
            : projectId
                ? 'project'
                : 'workspace';
    const needsWorkspaceFields = effectiveScope !== 'account';
    const isEmailEvent = visibilityMode === 'email';
    const selectedProject = useMemo(
        () => projects.find((project) => project.id === projectId) ?? null,
        [projectId, projects],
    );
    const audienceSummary = useMemo(() => {
        if (effectiveScope === 'account') return 'Visible to: Only you';
        return 'Visible to: Everyone in this workspace';
    }, [effectiveScope]);
    const projectSummary = selectedProject ? `Related to: ${selectedProject.name}` : 'Related to: No project';
    const relatedProjectNote = selectedProject
        ? `This event will be displayed for ${selectedProject.name} and workspace-wide calendar views.`
        : 'No project selected. This event will stay workspace scope.';
    const modalTitle = event ? 'Edit Event' : mailMessageId ? 'New Event from Email' : 'New Event';
    const deleteLabel = useMemo(() => {
        if (isPersistedEmailEvent) return 'Delete email event';
        if (event?.scope === 'workspace' || event?.scope === 'project') return 'Delete shared event';
        return 'Delete private event';
    }, [event?.scope, isPersistedEmailEvent]);
    const deleteConsequence = useMemo(() => {
        if (isPersistedEmailEvent) return 'This removes it from your OneWork calendar only.';
        if (event?.scope === 'workspace' || event?.scope === 'project') return "This will remove it from all members' calendars.";
        return 'Only you can see this event.';
    }, [event?.scope, isPersistedEmailEvent]);
    const canSelectEmail = isCreatingFromEmail || isPersistedEmailEvent;
    const pluginFieldsReadOnly = isPersistedPluginEvent && pluginProvider === 'calendly';
    const showWorkspaceOption = canUseWorkspaceScopes && !isPersistedPluginEvent;
    const isEmailLinkRemovalPending = (isPersistedEmailEvent || isCreatingFromEmail) && !linkToEmail;
    const selectedConferenceConnected = conferenceProvider === 'google_meet'
        ? integrationStatus.googleConnected
        : conferenceProvider === 'zoom'
            ? integrationStatus.zoomConnected
            : true;
    const selectedConferenceConfigured = conferenceProvider === 'google_meet'
        ? integrationStatus.googleConfigured
        : conferenceProvider === 'zoom'
            ? integrationStatus.zoomConfigured
            : true;
    const selectedConferenceLabel = conferenceProvider === 'google_meet' ? 'Google Calendar' : conferenceProvider === 'zoom' ? 'Zoom' : null;
    const existingConference = event?.conference ?? null;
    const hasExistingConferenceLink = Boolean(existingConference?.joinUrl);
    const showConferenceOptions = !hasExistingConferenceLink || isChangingConference;
    const isEditingCurrentConference =
        Boolean(existingConference) &&
        conferenceProvider !== 'none' &&
        existingConference?.provider === conferenceProvider;
    const startTime = useMemo(
        () => (isAllDay ? startDate : combineDateAndTime(startDate, startClock)),
        [isAllDay, startClock, startDate],
    );
    const endTime = useMemo(() => {
        if (isAllDay) return endDate;
        if (durationPreset !== 'custom') {
            return addMinutesToDateTimeLocal(startTime, durationPreset);
        }
        return combineDateAndTime(endDate, endClock);
    }, [durationPreset, endClock, endDate, isAllDay, startTime]);
    const computedEndLabel = useMemo(() => {
        if (isAllDay || durationPreset === 'custom' || !startTime || !endTime) return null;
        return formatTimeLabel(endTime);
    }, [durationPreset, endTime, isAllDay, startTime]);
    const recurrenceStartIso = useMemo(
        () => (startTime ? fromDateTimeLocal(startTime, isAllDay) : ''),
        [isAllDay, startTime],
    );
    const recurrencePlan = useMemo(() => {
        if (!isRecurring || !recurrenceUntilDate || !recurrenceStartIso) return null;
        return buildRecurrencePlan(
            recurrenceStartIso,
            recurrenceFrequency,
            recurrenceUntilFromDateLocal(recurrenceUntilDate),
            CALENDAR_RECURRENCE_OPTIONS,
        );
    }, [isRecurring, recurrenceFrequency, recurrenceStartIso, recurrenceUntilDate]);
    const seriesPlan = useMemo(() => {
        if (!isSeriesEvent || !isEditingSeriesRange || !event?.recurrenceFrequency || !seriesRecurrenceUntilDate || !recurrenceStartIso) return null;
        return buildRecurrencePlan(
            recurrenceStartIso,
            event.recurrenceFrequency,
            recurrenceUntilFromDateLocal(seriesRecurrenceUntilDate),
            CALENDAR_RECURRENCE_OPTIONS,
        );
    }, [event?.recurrenceFrequency, isEditingSeriesRange, isSeriesEvent, recurrenceStartIso, seriesRecurrenceUntilDate]);
    const recurrencePatternMismatch = isRecurring && !recurrenceStartMatchesPattern(recurrenceStartIso, recurrenceFrequency);
    const recurrenceProducesSingleEvent = (recurrencePlan?.occurrenceCount ?? 0) > 0 && (recurrencePlan?.occurrenceCount ?? 0) < 2;
    const seriesProducesTooFewEvents = (seriesPlan?.occurrenceCount ?? 0) > 0 && (seriesPlan?.occurrenceCount ?? 0) < 2;
    const selectedRecurrenceOption: 'none' | RecurrenceFrequency = isRecurring ? recurrenceFrequency : 'none';

    const refreshCalendarIntegrations = useCallback(async () => {
        setIsLoadingIntegrations(true);
        try {
            const status = await api.calendarIntegrations.status();
            const google = status.integrations.find((item) => item.provider === 'google_calendar');
            const zoom = status.integrations.find((item) => item.provider === 'zoom');
            setIntegrationStatus({
                googleConfigured: status.googleConfigured,
                zoomConfigured: status.zoomConfigured,
                googleConnected: Boolean(google?.connected),
                zoomConnected: Boolean(zoom?.connected),
                googleAccount: google?.accountEmail ?? google?.accountName ?? null,
                zoomAccount: zoom?.accountEmail ?? zoom?.accountName ?? null,
            });
        } catch {
            setIntegrationStatus((current) => ({
                ...current,
                googleConnected: false,
                zoomConnected: false,
            }));
        } finally {
            setIsLoadingIntegrations(false);
        }
    }, []);

    useEffect(() => {
        void refreshCalendarIntegrations();
    }, [refreshCalendarIntegrations]);

    useEffect(() => {
        const onMessage = (ev: MessageEvent) => {
            if (ev.origin !== window.location.origin) return;
            const data = ev.data as { source?: string; status?: 'connected' | 'error'; error?: string } | null;
            if (!data || data.source !== CALENDAR_OAUTH_MSG_SOURCE) return;
            if (data.status === 'connected') {
                addToast('Calendar integration connected', 'success');
                void refreshCalendarIntegrations();
            } else if (data.status === 'error') {
                addToast(data.error || 'Calendar integration failed', 'error');
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [addToast, refreshCalendarIntegrations]);

    const startCalendarOAuthPopup = (provider: 'google' | 'zoom') => {
        const url = api.calendarIntegrations.startUrl(provider, {
            returnTo: `${window.location.origin}/calendar`,
            popup: true,
        });
        const win = window.open(url, 'onework-calendar-oauth', 'width=520,height=720,scrollbars=yes,resizable=yes');
        if (!win) addToast('Allow pop-ups to connect this provider.', 'warning');
    };

    const getVisibilityButtonClass = (mode: 'private' | 'workspace' | 'email') => {
        const isActive = visibilityMode === mode;
        if (!isActive) return 'border-border-dark text-text-secondary hover:text-white disabled:hover:text-text-secondary';
        if (mode === 'email') return 'border-sky-500/25 bg-sky-500/10 text-sky-200';
        if (mode === 'workspace') return 'border-blue-500/25 bg-blue-500/10 text-blue-200';
        return 'border-amber-500/25 bg-amber-500/10 text-amber-200';
    };

    useClickOutside(modalRef, onClose);
    useClickOutside(projectPickerRef, () => setIsProjectPickerOpen(false));
    useClickOutside(attendeePickerRef, () => setIsAttendeePickerOpen(false));

    const handleAllDayChange = (checked: boolean) => {
        if (readOnly) return;
        const currentStart = isAllDay ? startDate : startTime;
        const currentEnd = isAllDay ? endDate : endTime;
        const nextStart = normalizeInputValue(currentStart, checked);
        const nextEnd = normalizeInputValue(currentEnd, checked);
        const startParts = splitDateTimeLocal(nextStart);
        const endParts = splitDateTimeLocal(nextEnd);
        setIsAllDay(checked);
        setStartDate(startParts.date);
        setStartClock(startParts.time);
        setEndDate(endParts.date);
        setEndClock(endParts.time);
        if (checked) {
            setDurationPreset('custom');
        } else {
            setDurationPreset(inferDurationPreset(nextStart, nextEnd, false));
        }
    };

    const handleStartDateChange = (value: string) => {
        if (readOnly) return;
        setStartDate(value);
        if (isAllDay) {
            if (endDate && value > endDate) setEndDate(value);
            return;
        }
        if (durationPreset !== 'custom') {
            const nextStart = combineDateAndTime(value, startClock);
            const nextEnd = addMinutesToDateTimeLocal(nextStart, durationPreset);
            const endParts = splitDateTimeLocal(nextEnd);
            setEndDate(endParts.date);
            setEndClock(endParts.time);
        }
    };

    const handleStartClockChange = (value: string) => {
        if (readOnly) return;
        setStartClock(value);
        if (isAllDay) return;
        if (durationPreset !== 'custom') {
            const nextStart = combineDateAndTime(startDate, value);
            const nextEnd = addMinutesToDateTimeLocal(nextStart, durationPreset);
            const endParts = splitDateTimeLocal(nextEnd);
            setEndDate(endParts.date);
            setEndClock(endParts.time);
        }
    };

    const handleDurationPresetChange = (value: EventDurationPreset) => {
        if (readOnly) return;
        setDurationPreset(value);
        if (value === 'custom' || isAllDay) return;
        const nextStart = combineDateAndTime(startDate, startClock);
        const nextEnd = addMinutesToDateTimeLocal(nextStart, value);
        const endParts = splitDateTimeLocal(nextEnd);
        setEndDate(endParts.date);
        setEndClock(endParts.time);
    };

    const handleEndDateChange = (value: string) => {
        if (readOnly) return;
        setDurationPreset('custom');
        setEndDate(value);
        if (isAllDay && startDate && value < startDate) {
            setStartDate(value);
        }
    };

    const handleEndClockChange = (value: string) => {
        if (readOnly) return;
        setDurationPreset('custom');
        setEndClock(value);
    };

    const handleRecurrenceOptionSelect = (value: 'none' | RecurrenceFrequency) => {
        if (value === 'none') {
            setRecurrence('one_time');
            return;
        }
        setRecurrence('recurring');
        setRecurrenceFrequency(value);
    };

    const handleSubmit = async (submitEvent: React.FormEvent) => {
        submitEvent.preventDefault();
        if (readOnly) {
            addToast('This project is read-only because your workspace is over its plan limit.', 'warning');
            return;
        }
        if (!title.trim()) return;
        if (needsWorkspaceFields && !calendarId) return;
        if (!selectedConferenceConfigured) {
            addToast(`${selectedConferenceLabel} OAuth is not configured yet`, 'error');
            return;
        }
        if (!selectedConferenceConnected) {
            addToast(`Connect ${selectedConferenceLabel} before creating this meeting link`, 'warning');
            return;
        }
        if (isRecurring && !recurrenceUntilDate) {
            addToast('Choose a "repeat until" date for recurring events', 'warning');
            return;
        }
        if (recurrencePatternMismatch) {
            addToast(`Choose a ${recurrenceFrequency === 'weekdays' ? 'weekday' : 'weekend'} start date for this repeat pattern`, 'warning');
            return;
        }
        if (recurrenceProducesSingleEvent) {
            addToast('Recurring events must generate at least 2 occurrences', 'warning');
            return;
        }
        if (isEditingSeriesRange && seriesProducesTooFewEvents) {
            addToast('The updated series must keep at least 2 occurrences', 'warning');
            return;
        }

        setIsSaving(true);
        try {
            const basePayload = {
                scope: effectiveScope,
                title: title.trim(),
                description: description.trim() || null,
                location: location.trim() || null,
                startTime: fromDateTimeLocal(startTime, isAllDay),
                endTime: fromDateTimeLocal(endTime, isAllDay, true),
                timezone,
                isAllDay,
                conferenceProvider,
                attendeeIds: needsWorkspaceFields ? attendeeIds : [],
            };

            if (event) {
                const payload: UpdateEventInput = needsWorkspaceFields
                    ? {
                        ...basePayload,
                        source: linkToEmail ? 'email' : 'manual',
                        workspaceId: workspaceId ?? event.workspaceId ?? null,
                        calendarId,
                        projectId: effectiveScope === 'project' ? projectId || null : null,
                    }
                    : {
                        ...basePayload,
                        source: linkToEmail ? 'email' : 'manual',
                        workspaceId: null,
                        projectId: null,
                    };
                const metadataChanged =
                    location.trim() !== resolvedInitialLocation ||
                    title.trim() !== (event.title ?? '').trim() ||
                    description.trim() !== (event.description ?? '').trim();
                if (event.seriesId && metadataChanged) {
                    payload.seriesUpdateScope = 'series';
                } else if (isEditingEntireSeries) {
                    payload.seriesUpdateScope = 'series';
                } else if (isEditingFutureSeries) {
                    payload.seriesUpdateScope = 'following';
                }
                if (isEditingSeriesRange && seriesRecurrenceUntilDate) {
                    payload.seriesRecurrenceUntil = recurrenceUntilFromDateLocal(seriesRecurrenceUntilDate);
                }
                await api.events.update(event.id, payload);
                addToast(
                    isEditingEntireSeries ? 'Entire series updated' : isEditingFutureSeries ? 'Future events updated' : 'Event updated',
                    'success',
                );
            } else if (linkToEmail && mailMessageId) {
                const payload: CreateEmailEventInput = {
                    mailMessageId,
                    title: title.trim(),
                    description: description.trim() || null,
                    location: location.trim() || null,
                    startTime: fromDateTimeLocal(startTime, isAllDay),
                    endTime: fromDateTimeLocal(endTime, isAllDay, true),
                    timezone,
                    isAllDay,
                };
                await api.events.createFromEmail(payload);
                addToast('Event created', 'success');
            } else {
                const payload: CreateEventInput = {
                    ...basePayload,
                    workspaceId: needsWorkspaceFields ? workspaceId ?? null : null,
                    calendarId: needsWorkspaceFields ? calendarId : null,
                    projectId: effectiveScope === 'project' ? projectId || null : null,
                    recurrenceFrequency: isRecurring ? recurrenceFrequency : null,
                    recurrenceUntil: isRecurring ? recurrenceUntilFromDateLocal(recurrenceUntilDate) : null,
                };
                await api.events.create(payload);
                addToast(isRecurring ? 'Recurring event created' : 'Event created', 'success');
            }

            onSaved?.();
            onClose();
        } catch (error: unknown) {
            addToast(error instanceof Error ? error.message : 'Failed to save event', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (scope?: 'following' | 'series') => {
        if (!event || readOnly) return;

        setIsSaving(true);
        try {
            await api.events.delete(event.id, scope ? { scope } : undefined);
            addToast(scope === 'series' ? 'Series deleted' : scope === 'following' ? 'Future events deleted' : 'Event deleted', 'success');
            setConfirmingDelete(false);
            onSaved?.();
            onClose();
        } catch (error: unknown) {
            addToast(error instanceof Error ? error.message : 'Failed to delete event', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleCopyMeetingLink = async () => {
        const joinUrl = event?.conference?.joinUrl;
        if (!joinUrl) return;
        try {
            await navigator.clipboard.writeText(joinUrl);
            addToast('Meeting link copied', 'success');
        } catch {
            addToast('Could not copy meeting link', 'error');
        }
    };

    return (
        <div ref={modalRef} className="w-full max-w-2xl mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between bg-white/[0.02]">
                <h2 className="text-xl font-bold text-white">{modalTitle}</h2>
                <button onClick={onClose} className="cursor-pointer text-text-secondary hover:text-white" aria-label="Close dialog">
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>

            <form onSubmit={handleSubmit} className="max-h-[calc(100dvh-10rem)] overflow-y-auto p-6 space-y-5">
                {readOnly && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-200">
                        This project is read-only because your workspace is over its plan limit. Upgrade to restore editing.
                    </div>
                )}
                {isCreatingFromEmail && emailPreview && (
                    <div className="rounded-xl border border-border-dark bg-white/[0.03] px-4 py-3">
                        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border-dark bg-background-dark/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary">
                            <EmailIcon size={14} />
                            From email
                        </div>
                        <p className="truncate text-sm font-medium text-white">{emailPreview.subject}</p>
                        <p className="mt-1 text-xs text-text-secondary">{`${emailPreview.from} · ${emailPreview.date}`}</p>
                    </div>
                )}
                <div className="space-y-1.5">
                    <label htmlFor="event-title" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Title</label>
                    <input
                        id="event-title"
                        autoFocus
                        value={title}
                        onChange={(changeEvent) => setTitle(changeEvent.target.value)}
                        disabled={readOnly || pluginFieldsReadOnly}
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-lg font-medium focus:ring-1 focus:ring-primary focus:border-primary px-4 py-3 transition-all placeholder:text-text-secondary/50 outline-none disabled:opacity-60"
                        placeholder="Team planning"
                    />
                </div>
                {isPersistedEmailEvent && (
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                        <EmailIcon size={14} />
                        <span>Linked from email</span>
                        <span aria-hidden="true">·</span>
                        <span>{linkToEmail ? 'Private event' : 'Will convert on save'}</span>
                    </div>
                )}
                {isPersistedPluginEvent && (
                    <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-3 text-xs text-violet-200">
                        <div className="flex items-center gap-2 font-bold">
                            {pluginProvider ? <PluginIcon id={calendarPluginIconId(pluginProvider)} size={14} /> : null}
                            <span>Synced via {pluginProviderLabel}</span>
                        </div>
                        {pluginFieldsReadOnly ? (
                            <p className="mt-2 text-violet-200/80">
                                Calendly bookings sync inbound only. Reschedule or cancel in Calendly.
                            </p>
                        ) : pluginCaps?.canUpdateEvents ? (
                            <p className="mt-2 text-violet-200/80">
                                Changes save to OneWork and sync back to {pluginProviderLabel}.
                            </p>
                        ) : null}
                    </div>
                )}
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Visibility</label>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => {
                                if (readOnly) return;
                                setIsShared(false);
                                setLinkToEmail(false);
                            }}
                            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-45 ${getVisibilityButtonClass('private')}`}
                        >
                            <PersonIcon size={16} />
                            Private
                        </button>
                        <button
                            type="button"
                            disabled={readOnly || !showWorkspaceOption}
                            onClick={() => {
                                if (readOnly) return;
                                setIsShared(true);
                                setLinkToEmail(false);
                            }}
                            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-45 ${getVisibilityButtonClass('workspace')}`}
                        >
                            <GlobeIcon size={16} />
                            Workspace
                        </button>
                        <button
                            type="button"
                            disabled={readOnly || !canSelectEmail}
                            onClick={() => {
                                if (readOnly) return;
                                setIsShared(false);
                                setLinkToEmail(true);
                            }}
                            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-45 ${getVisibilityButtonClass('email')}`}
                        >
                            <EmailIcon size={16} />
                            Email
                        </button>
                    </div>
                    <p className="text-xs text-text-secondary">
                        {visibilityMode === 'email'
                            ? 'This event stays linked to its source email and remains private to you.'
                            : visibilityMode === 'workspace'
                                ? 'Everyone in this workspace can see this event.'
                                : 'Only you can see this event.'}
                    </p>
                    {isEmailLinkRemovalPending && (
                        <p className="text-xs text-amber-200">
                            Saving this change will remove the email link. You won&apos;t be able to switch it back to Email later.
                        </p>
                    )}
                    {linkToEmail && !event && (
                        <p className="text-xs text-text-secondary">
                            To repeat this event, switch it from Email to Private or Workspace first.
                        </p>
                    )}
                </div>

                <div className="space-y-4">
                    <div className={`grid grid-cols-1 gap-4 ${isAllDay ? 'sm:grid-cols-2' : 'sm:grid-cols-[1fr_auto]'}`}>
                        <EventDatePicker
                            id="event-start-date"
                            label="Start date"
                            value={startDate}
                            onChange={handleStartDateChange}
                            disabled={readOnly}
                        />
                        {!isAllDay && (
                            <div className="space-y-1.5 sm:w-36">
                                <label htmlFor="event-start-time" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                                    Start time
                                </label>
                                <input
                                    id="event-start-time"
                                    type="time"
                                    value={startClock}
                                    onChange={(changeEvent) => handleStartClockChange(changeEvent.target.value)}
                                    disabled={readOnly}
                                    className="mt-1.5 w-full rounded-xl border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white transition-all [color-scheme:dark] outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                                />
                            </div>
                        )}
                    </div>

                    {!isAllDay && (
                        <div className="space-y-1.5">
                            <label htmlFor="event-duration" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                                Duration
                            </label>
                            <select
                                id="event-duration"
                                value={durationPreset}
                                onChange={(changeEvent) => handleDurationPresetChange(changeEvent.target.value as EventDurationPreset)}
                                disabled={readOnly}
                                className="w-full rounded-xl border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white outline-none transition-all focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {EVENT_DURATION_OPTIONS.map((option) => (
                                    <option key={String(option.value)} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            {computedEndLabel && (
                                <p className="text-xs text-text-secondary">
                                    Ends {computedEndLabel}
                                </p>
                            )}
                        </div>
                    )}

                    {(isAllDay || durationPreset === 'custom') && (
                        <div className={`grid grid-cols-1 gap-4 ${isAllDay ? 'sm:grid-cols-2' : 'sm:grid-cols-[1fr_auto]'}`}>
                            <EventDatePicker
                                id="event-end-date"
                                label={isAllDay ? 'End date' : 'End date (custom)'}
                                value={endDate}
                                minDate={startDate}
                                onChange={handleEndDateChange}
                                disabled={readOnly}
                            />
                            {!isAllDay && (
                                <div className="space-y-1.5 sm:w-36">
                                    <label htmlFor="event-end-time" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                                        End time
                                    </label>
                                    <input
                                        id="event-end-time"
                                        type="time"
                                        value={endClock}
                                        onChange={(changeEvent) => handleEndClockChange(changeEvent.target.value)}
                                        disabled={readOnly}
                                        className="mt-1.5 w-full rounded-xl border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white transition-all [color-scheme:dark] outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <label className="flex items-center gap-3 text-sm font-bold text-white">
                    <input
                        type="checkbox"
                        checked={isAllDay}
                        onChange={(changeEvent) => handleAllDayChange(changeEvent.target.checked)}
                        disabled={readOnly}
                        className="size-4 rounded border-border-dark bg-background-dark disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    All-day event
                </label>

                <div className="space-y-1.5">
                    <label htmlFor="event-location" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Location</label>
                    <input
                        id="event-location"
                        value={location}
                        onChange={(changeEvent) => setLocation(changeEvent.target.value)}
                        disabled={readOnly}
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-2.5 transition-all placeholder:text-text-secondary/50 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder="Office, Zoom, or URL"
                    />
                    {isSeriesEvent && (
                        <p className="text-[11px] text-text-secondary">
                            Location changes apply to the entire series automatically.
                        </p>
                    )}
                </div>

                {showRecurrenceOptions && (
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Repeat</label>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {RECURRENCE_OPTIONS.map((option) => {
                                const isActive = selectedRecurrenceOption === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => handleRecurrenceOptionSelect(option.value)}
                                        className={`cursor-pointer rounded-lg border px-3 py-2.5 text-left text-xs font-bold transition-colors ${isActive ? 'border-primary bg-primary/15 text-white' : 'border-border-dark bg-background-dark text-text-secondary hover:text-white'}`}
                                    >
                                        <span className="block">{option.label}</span>
                                        {option.hint && <span className="mt-0.5 block text-[10px] font-normal opacity-70">{option.hint}</span>}
                                    </button>
                                );
                            })}
                        </div>
                        {isRecurring && (
                            <div className="space-y-3 rounded-lg border border-border-dark bg-background-dark/40 p-3">
                                <EventDatePicker
                                    id="event-recurrence-until"
                                    label="Ends"
                                    value={recurrenceUntilDate}
                                    minDate={startDate}
                                    onChange={setRecurrenceUntilDate}
                                    disabled={readOnly}
                                />
                                <div className="space-y-1.5 text-[11px]">
                                    {recurrencePlan && (
                                        <p className="text-white">
                                            Creates {recurrencePlan.occurrenceCount} event{recurrencePlan.occurrenceCount === 1 ? '' : 's'} through {formatDateLabel(recurrencePlan.effectiveUntilIso)}.
                                        </p>
                                    )}
                                    {recurrencePatternMismatch && (
                                        <p className="text-amber-200">
                                            {recurrenceFrequency === 'weekdays'
                                                ? 'This pattern needs a weekday start date. Move the event to Monday-Friday or choose another repeat option.'
                                                : 'This pattern needs a weekend start date. Move the event to Saturday or Sunday or choose another repeat option.'}
                                        </p>
                                    )}
                                    {recurrenceProducesSingleEvent && (
                                        <p className="text-amber-200">
                                            Choose a later end date to create a series with at least two events.
                                        </p>
                                    )}
                                    {recurrenceFrequency === 'monthly' && (
                                        <p className="text-text-secondary">
                                            Monthly repeats stay on the same calendar date when possible. Shorter months use their last day.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {isSeriesEvent && (
                    <div className="space-y-2 rounded-lg border border-border-dark bg-background-dark/40 p-3">
                        <p className="flex items-center gap-2 text-xs font-bold text-white">
                            <span className="material-symbols-outlined text-[16px]">repeat</span>
                            {event?.recurrenceFrequency ? `Part of a ${recurrenceFrequencyLabel(event.recurrenceFrequency).toLowerCase()} series` : 'Part of a recurring series'}
                        </p>
                        {event?.recurrenceFrequency && event?.recurrenceUntil && (
                            <p className="text-[11px] text-text-secondary">
                                {buildRecurrenceDescriptionNote(event.recurrenceFrequency, event.recurrenceUntil)}
                            </p>
                        )}
                        <div className="flex overflow-hidden rounded-lg border border-border-dark">
                            <button
                                type="button"
                                onClick={() => setSeriesScope('single')}
                                className={`cursor-pointer flex-1 py-2 text-xs font-bold transition-colors ${seriesScope === 'single' ? 'bg-primary text-white' : 'bg-background-dark text-text-secondary hover:text-white'}`}
                            >
                                This event
                            </button>
                            <button
                                type="button"
                                onClick={() => setSeriesScope('following')}
                                className={`cursor-pointer flex-1 py-2 text-xs font-bold transition-colors ${seriesScope === 'following' ? 'bg-primary text-white' : 'bg-background-dark text-text-secondary hover:text-white'}`}
                            >
                                This and following
                            </button>
                            <button
                                type="button"
                                onClick={() => setSeriesScope('series')}
                                className={`cursor-pointer flex-1 py-2 text-xs font-bold transition-colors ${seriesScope === 'series' ? 'bg-primary text-white' : 'bg-background-dark text-text-secondary hover:text-white'}`}
                            >
                                Entire series
                            </button>
                        </div>
                        <p className="text-[11px] text-text-secondary">
                            {seriesScope === 'series'
                                ? 'Changes apply to every event in the series.'
                                : seriesScope === 'following'
                                    ? 'Changes apply to this event and every future event. Earlier events stay unchanged.'
                                    : 'Changes apply to this occurrence only.'}
                        </p>
                        {isEditingSeriesRange && (
                            <div className="space-y-2 rounded-lg border border-border-dark bg-background-dark/60 p-3">
                                <EventDatePicker
                                    id="event-series-until"
                                    label={seriesScope === 'following' ? 'Future series ends' : 'Series ends'}
                                    value={seriesRecurrenceUntilDate}
                                    minDate={startDate}
                                    onChange={setSeriesRecurrenceUntilDate}
                                    disabled={readOnly}
                                />
                                <p className="text-[11px] text-text-secondary">
                                    {seriesScope === 'following'
                                        ? 'This event becomes the start of a new future series. To change the repeat pattern, recreate the series.'
                                        : 'You can extend or shorten this series here. To change the repeat pattern, recreate the series.'}
                                </p>
                                {seriesPlan && (
                                    <p className="text-[11px] text-white">
                                        Keeps {seriesPlan.occurrenceCount} occurrence{seriesPlan.occurrenceCount === 1 ? '' : 's'} through {formatDateLabel(seriesPlan.effectiveUntilIso)}.
                                    </p>
                                )}
                                {seriesProducesTooFewEvents && (
                                    <p className="text-[11px] text-amber-200">
                                        The updated series must keep at least 2 occurrences.
                                    </p>
                                )}
                                {event?.recurrenceFrequency === 'monthly' && (
                                    <p className="text-[11px] text-text-secondary">
                                        Monthly repeats stay on the same calendar date when possible. Shorter months use their last day.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="space-y-3">
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Video Conferencing</label>
                    {showConferenceOptions ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                <button
                                    type="button"
                                    disabled={readOnly}
                                    onClick={() => { if (!readOnly) setConferenceProvider('none'); }}
                                    className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${conferenceProvider === 'none' ? 'border-primary/60 bg-primary/10 text-blue-100' : `border-border-dark bg-background-dark text-text-secondary ${readOnly ? '' : 'hover:text-white'}`}`}
                                >
                                    <span className="material-symbols-outlined text-[17px]">videocam_off</span>
                                    No video
                                </button>
                                <button
                                    type="button"
                                    disabled={readOnly}
                                    onClick={() => { if (!readOnly) setConferenceProvider('google_meet'); }}
                                    className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${conferenceProvider === 'google_meet' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : `border-border-dark bg-background-dark text-text-secondary ${readOnly ? '' : 'hover:text-white'}`}`}
                                >
                                    <span className="material-symbols-outlined text-[17px]">duo</span>
                                    Google Meet
                                </button>
                                <button
                                    type="button"
                                    disabled={readOnly}
                                    onClick={() => { if (!readOnly) setConferenceProvider('zoom'); }}
                                    className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${conferenceProvider === 'zoom' ? 'border-sky-500/40 bg-sky-500/10 text-sky-100' : `border-border-dark bg-background-dark text-text-secondary ${readOnly ? '' : 'hover:text-white'}`}`}
                                >
                                    <span className="material-symbols-outlined text-[17px]">video_call</span>
                                    Zoom
                                </button>
                            </div>
                            {hasExistingConferenceLink && (
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-[11px] text-amber-200">
                                        {conferenceProvider === 'none'
                                            ? 'Choosing No video will remove the linked meeting when you save.'
                                            : conferenceProvider !== existingConference?.provider
                                                ? 'Switching providers will replace the current meeting link when you save.'
                                                : 'Keep this provider to continue updating the current meeting on save.'}
                                    </p>
                                    <button
                                        type="button"
                                        disabled={readOnly}
                                        onClick={() => {
                                            if (readOnly) return;
                                            setConferenceProvider(existingConference?.provider ?? 'none');
                                            setIsChangingConference(false);
                                        }}
                                        className="text-xs font-bold text-text-secondary hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-text-secondary"
                                    >
                                        Cancel change
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-dark bg-background-dark px-4 py-3">
                            <div>
                                <p className="text-sm font-bold text-white">
                                    {existingConference?.provider === 'google_meet' ? 'Google Meet linked' : existingConference?.provider === 'zoom' ? 'Zoom meeting linked' : 'Meeting linked'}
                                </p>
                                <p className="mt-1 text-xs text-text-secondary">
                                    Saving title, time, or details will update this linked meeting.
                                </p>
                            </div>
                            <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => { if (!readOnly) setIsChangingConference(true); }}
                                className="rounded-lg border border-border-dark bg-surface-dark px-3 py-2 text-xs font-bold text-white hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface-dark"
                            >
                                Change video conferencing
                            </button>
                        </div>
                    )}
                    {conferenceProvider !== 'none' && !hasExistingConferenceLink && (
                        <div className={`rounded-xl border px-4 py-3 ${selectedConferenceConnected ? 'border-emerald-500/25 bg-emerald-500/10' : 'border-amber-500/25 bg-amber-500/10'}`}>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="text-sm font-bold text-white">
                                        {selectedConferenceConnected
                                            ? `${selectedConferenceLabel} is ready`
                                            : `${selectedConferenceLabel} not connected`}
                                    </p>
                                    <p className="mt-1 text-xs text-text-secondary">
                                        {selectedConferenceConnected
                                            ? `OneWork will generate and save the ${conferenceProvider === 'google_meet' ? 'Meet' : 'Zoom'} join URL on save.`
                                            : `Connect ${selectedConferenceLabel} to generate meeting links for this event.`}
                                    </p>
                                    {selectedConferenceConnected && (
                                        <p className="mt-1 text-[11px] text-text-secondary">
                                            Connected as {conferenceProvider === 'google_meet' ? integrationStatus.googleAccount : integrationStatus.zoomAccount}
                                        </p>
                                    )}
                                </div>
                                {!selectedConferenceConnected && (
                                    <button
                                        type="button"
                                        disabled={readOnly || isLoadingIntegrations || !selectedConferenceConfigured}
                                        onClick={() => startCalendarOAuthPopup(conferenceProvider === 'google_meet' ? 'google' : 'zoom')}
                                        className="cursor-pointer rounded-lg bg-primary px-3 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                                    >
                                        {!selectedConferenceConfigured ? 'Not configured' : `Connect ${conferenceProvider === 'google_meet' ? 'Google' : 'Zoom'}`}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    {event?.conference?.joinUrl && (
                        <div className="space-y-3 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <a
                                    href={event.conference.joinUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-lg border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs font-bold text-blue-100 hover:bg-blue-500/15"
                                >
                                    <span className="material-symbols-outlined text-[16px]">{meetingLinkIcon(event.conference.provider)}</span>
                                    {meetingLinkLabel(event.conference.provider)}
                                </a>
                                <button
                                    type="button"
                                    onClick={() => void handleCopyMeetingLink()}
                                    className="cursor-pointer inline-flex items-center gap-2 rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-xs font-bold text-text-secondary hover:text-white"
                                >
                                    <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                    Copy link
                                </button>
                            </div>
                            {isEditingCurrentConference && (
                                <p className="text-[11px] text-blue-100/80">
                                    Changes to the title, time, or details will update this linked meeting when you save.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {needsWorkspaceFields && (
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <label htmlFor="event-project" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Related Project</label>
                            <div ref={projectPickerRef} className="relative">
                                <button
                                    id="event-project"
                                    type="button"
                                    disabled={readOnly}
                                    onClick={() => { if (!readOnly) setIsProjectPickerOpen((current) => !current); }}
                                    className="flex w-full items-center gap-3 rounded-xl border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white transition-all outline-none hover:border-white/20 focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border-dark"
                                >
                                    {selectedProject ? (
                                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: selectedProject.color }} />
                                    ) : (
                                        <span className="material-symbols-outlined text-[18px] text-text-secondary">workspaces</span>
                                    )}
                                    <span className={`flex-1 truncate text-left ${selectedProject ? 'font-medium text-white' : 'text-text-secondary'}`}>
                                        {selectedProject?.name ?? 'Select project from this workspace'}
                                    </span>
                                    <span className={`material-symbols-outlined text-[18px] text-text-secondary transition-transform ${isProjectPickerOpen ? 'rotate-180' : ''}`}>
                                        expand_more
                                    </span>
                                </button>

                                {isProjectPickerOpen && (
                                    <div className="absolute left-0 top-full z-20 mt-2 w-full overflow-hidden rounded-xl border border-border-dark bg-surface-dark shadow-2xl shadow-black/40">
                                        <div className="max-h-64 overflow-y-auto p-2 custom-scrollbar">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (readOnly) return;
                                                    setProjectId('');
                                                    setIsProjectPickerOpen(false);
                                                }}
                                                className={`cursor-pointer flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors ${projectId === ''
                                                    ? 'bg-white/5 text-main'
                                                    : 'text-text-secondary hover:bg-white/5 hover:text-main'
                                                    }`}
                                            >
                                                <span className="material-symbols-outlined text-[18px] text-text-secondary shrink-0">workspaces</span>
                                                <span className="flex-1 truncate text-left font-bold">No project</span>
                                                {projectId === '' && (
                                                    <span className="material-symbols-outlined text-[18px] text-main">check</span>
                                                )}
                                            </button>
                                            {projects.map((project) => {
                                                const isActive = project.id === projectId;
                                                const projectLocked = project.quota_locked === true;
                                                return (
                                                    <button
                                                        key={project.id}
                                                        type="button"
                                                        disabled={projectLocked}
                                                        onClick={() => {
                                                            if (projectLocked) return;
                                                            setProjectId(project.id);
                                                            setIsProjectPickerOpen(false);
                                                        }}
                                                        className={`flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${isActive
                                                            ? 'bg-white/5 text-main'
                                                            : projectLocked ? 'text-text-secondary' : 'text-text-secondary hover:bg-white/5 hover:text-main'
                                                            }`}
                                                    >
                                                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
                                                        <span className="flex-1 truncate text-left font-bold">{project.name}</span>
                                                        {projectLocked && (
                                                            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-300">Read-only</span>
                                                        )}
                                                        {isActive && (
                                                            <span className="material-symbols-outlined text-[18px] text-main">check</span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-text-secondary">
                                {relatedProjectNote}
                            </p>
                        </div>

                        {hasMultipleWorkspaceCalendars && (
                            <div className="space-y-1.5">
                                <label htmlFor="event-calendar" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Calendar Category</label>
                                <select
                                    id="event-calendar"
                                    value={calendarId}
                                    onChange={(changeEvent) => setCalendarId(changeEvent.target.value)}
                                    disabled={readOnly}
                                    className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-2.5 transition-all outline-none disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {calendars.map((calendar) => (
                                        <option key={calendar.id} value={calendar.id}>{calendar.name}</option>
                                    ))}
                                </select>
                                <p className="text-xs text-text-secondary">
                                    Used for grouping and color. It does not change who can see the event.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {needsWorkspaceFields && (
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Attendees</label>
                        <div ref={attendeePickerRef} className="relative">
                            <button
                                type="button"
                                disabled={readOnly}
                                onClick={() => { if (!readOnly) setIsAttendeePickerOpen((prev) => !prev); }}
                                className="flex w-full items-center gap-3 rounded-xl border border-border-dark bg-background-dark px-4 py-2.5 text-sm text-white transition-all outline-none hover:border-white/20 focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border-dark"
                            >
                                <span className="material-symbols-outlined text-[18px] text-text-secondary">group</span>
                                <span className={`flex-1 text-left ${attendeeIds.length === 0 ? 'text-text-secondary' : 'text-white font-medium'}`}>
                                    {attendeeIds.length === 0
                                        ? 'Add attendees'
                                        : `${attendeeIds.length} attendee${attendeeIds.length === 1 ? '' : 's'}`}
                                </span>
                                {attendeeIds.length > 0 && (
                                    <div className="flex -space-x-1.5">
                                        {attendeeIds.slice(0, 3).map((uid) => {
                                            const u = users.find((m) => m.id === uid);
                                            if (!u) return null;
                                            return (
                                                <div key={uid} className="relative size-5">
                                                    <img src={u.avatar} alt={u.name} className="size-5 rounded-full border border-border-dark object-cover" />
                                                </div>
                                            );
                                        })}
                                        {attendeeIds.length > 3 && (
                                            <div className="size-5 rounded-full bg-white/10 border border-border-dark flex items-center justify-center text-[9px] font-bold text-text-secondary">
                                                +{attendeeIds.length - 3}
                                            </div>
                                        )}
                                    </div>
                                )}
                                <span className={`material-symbols-outlined text-[18px] text-text-secondary transition-transform ${isAttendeePickerOpen ? 'rotate-180' : ''}`}>
                                    expand_more
                                </span>
                            </button>

                            {isAttendeePickerOpen && (
                                <div className="absolute left-0 top-full z-20 mt-2 w-full overflow-hidden rounded-xl border border-border-dark bg-surface-dark shadow-2xl shadow-black/40">
                                    <div className="max-h-56 overflow-y-auto p-2 custom-scrollbar">
                                        {users.length === 0 ? (
                                            <p className="px-3 py-2 text-sm text-text-secondary">No workspace members found</p>
                                        ) : (
                                            users.map((member) => {
                                                const isSelected = attendeeIds.includes(member.id);
                                                return (
                                                    <button
                                                        key={member.id}
                                                        type="button"
                                                        onClick={() => {
                                                            if (readOnly) return;
                                                            setAttendeeIds((prev) =>
                                                                isSelected
                                                                    ? prev.filter((id) => id !== member.id)
                                                                    : [...prev, member.id],
                                                            );
                                                        }}
                                                        className={`cursor-pointer flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors ${isSelected ? 'bg-white/5 text-main' : 'text-text-secondary hover:bg-white/5 hover:text-main'}`}
                                                    >
                                                        <div className="relative size-6 shrink-0">
                                                            <img src={member.avatar} alt={member.name} className="size-6 rounded-full object-cover" />
                                                            <span className="absolute -bottom-0.5 -right-0.5">
                                                                <PresenceDot status={presenceFromMemberStatus(member.status)} />
                                                            </span>
                                                        </div>
                                                        <span className="flex-1 truncate text-left font-bold">{member.name}</span>
                                                        {isSelected && (
                                                            <span className="material-symbols-outlined text-[18px] text-main">check</span>
                                                        )}
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="space-y-1.5">
                    <label htmlFor="event-description" className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Description</label>
                    <textarea
                        id="event-description"
                        rows={3}
                        value={description}
                        onChange={(changeEvent) => setDescription(changeEvent.target.value)}
                        disabled={readOnly}
                        className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary px-4 py-3 transition-all resize-none placeholder:text-text-secondary/50 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    />
                </div>

                <div className="space-y-1 text-[10px] font-medium text-text-secondary">
                    <p>{audienceSummary}</p>
                    {needsWorkspaceFields && <p>{projectSummary}</p>}
                </div>

                <div className="flex flex-col gap-3 pt-4 border-t border-white/5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        {event && (
                            confirmingDelete ? (
                                <div className="flex flex-col gap-2">
                                    <span className="text-sm font-bold text-red-300">{`Delete "${event.title}"?`}</span>
                                    <p className="text-xs text-text-secondary">{deleteConsequence}</p>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handleDelete()}
                                            disabled={readOnly || isSaving}
                                            className="cursor-pointer px-3 py-2 rounded-lg bg-red-500/15 text-red-300 text-sm font-bold hover:bg-red-500/25 transition-colors disabled:opacity-50"
                                        >
                                            {isSeriesEvent ? 'This event' : 'Confirm'}
                                        </button>
                                        {isSeriesEvent && (
                                            <button
                                                type="button"
                                                onClick={() => handleDelete('following')}
                                                disabled={isSaving}
                                                className="cursor-pointer px-3 py-2 rounded-lg bg-red-500/15 text-red-300 text-sm font-bold hover:bg-red-500/25 transition-colors disabled:opacity-50"
                                            >
                                                This and following
                                            </button>
                                        )}
                                        {isSeriesEvent && (
                                            <button
                                                type="button"
                                                onClick={() => handleDelete('series')}
                                                disabled={isSaving}
                                                className="cursor-pointer px-3 py-2 rounded-lg bg-red-500/15 text-red-300 text-sm font-bold hover:bg-red-500/25 transition-colors disabled:opacity-50"
                                            >
                                                Entire series
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setConfirmingDelete(false)}
                                            disabled={isSaving}
                                            className="cursor-pointer px-3 py-2 text-text-secondary text-sm font-bold hover:text-white transition-colors disabled:opacity-50"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setConfirmingDelete(true)}
                                    disabled={readOnly || isSaving}
                                    className="cursor-pointer px-4 py-2.5 text-red-400 text-sm font-bold hover:text-red-300 transition-colors disabled:opacity-50"
                                >
                                    {deleteLabel}
                                </button>
                            )
                        )}
                    </div>
                    <div className="flex justify-end gap-3">
                        <button type="button" onClick={onClose} disabled={isSaving}
                            className="cursor-pointer px-6 py-2.5 text-text-secondary text-sm font-bold hover:text-white transition-colors">
                            Cancel
                        </button>
                        <button type="submit" disabled={
                            readOnly ||
                            isSaving ||
                            !title.trim() ||
                            (needsWorkspaceFields && !calendarId) ||
                            !startTime ||
                            !endTime ||
                            !selectedConferenceConfigured ||
                            !selectedConferenceConnected ||
                            recurrencePatternMismatch ||
                            recurrenceProducesSingleEvent ||
                            seriesProducesTooFewEvents
                        }
                            className="cursor-pointer px-8 py-2.5 bg-primary text-white text-sm font-black rounded-xl shadow-lg shadow-primary/30 hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-50">
                            {isSaving ? 'Saving...' : event ? 'Save Event' : 'Create Event'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
};
