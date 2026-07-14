import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const timezoneSchema = z.string().refine((value) => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}, 'Invalid timezone');

export const dateTimeSchema = z.string().refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed);
}, 'Invalid date/time');

export const conferenceProviderSchema = z.enum(['none', 'google_meet', 'zoom']);

export const recurrenceFrequencySchema = z.enum(['daily', 'weekdays', 'weekends', 'weekly', 'monthly']);
export const seriesUpdateScopeSchema = z.enum(['following', 'series']);

export const createCalendarSchema = z.object({
    workspaceId: uuidSchema,
    name: z.string().trim().min(1).max(120),
    color: z.string().trim().max(32).nullable().optional(),
    timezone: timezoneSchema.default('Asia/Manila'),
    isDefault: z.boolean().optional().default(false),
});

export const createEventSchema = z.object({
    scope: z.enum(['account', 'workspace', 'project']),
    calendarId: uuidSchema.nullable().optional(),
    workspaceId: uuidSchema.nullable().optional(),
    projectId: uuidSchema.nullable().optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
    startTime: dateTimeSchema,
    endTime: dateTimeSchema,
    timezone: timezoneSchema,
    isAllDay: z.boolean().optional().default(false),
    conferenceProvider: conferenceProviderSchema.optional().default('none'),
    attendeeIds: z.array(uuidSchema).optional().default([]),
    recurrenceFrequency: recurrenceFrequencySchema.nullable().optional(),
    recurrenceUntil: dateTimeSchema.nullable().optional(),
}).superRefine((value, ctx) => {
    if (value.recurrenceFrequency && !value.recurrenceUntil) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'recurrenceUntil is required for recurring events',
            path: ['recurrenceUntil'],
        });
    }
    if (!value.recurrenceFrequency && value.recurrenceUntil) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'recurrenceFrequency is required when recurrenceUntil is set',
            path: ['recurrenceFrequency'],
        });
    }
    if (value.recurrenceFrequency && value.recurrenceUntil) {
        const untilMs = new Date(value.recurrenceUntil).getTime();
        const startMs = new Date(value.startTime).getTime();
        if (!Number.isFinite(untilMs) || untilMs < startMs) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Repeat until must be on or after the first event date',
                path: ['recurrenceUntil'],
            });
        }
    }

    if (value.scope === 'account') {
        if (value.workspaceId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Account-scoped events cannot include workspaceId',
                path: ['workspaceId'],
            });
        }
        if (value.calendarId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Account-scoped events cannot include calendarId',
                path: ['calendarId'],
            });
        }
        if (value.projectId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Account-scoped events cannot include projectId',
                path: ['projectId'],
            });
        }
        return;
    }

    if (!value.workspaceId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'workspaceId is required',
            path: ['workspaceId'],
        });
    }

    if (value.scope === 'workspace' && !value.calendarId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'calendarId is required for workspace events',
            path: ['calendarId'],
        });
    }

    if (value.scope === 'project') {
        if (!value.calendarId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'calendarId is required for project events',
                path: ['calendarId'],
            });
        }
        if (!value.projectId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'projectId is required for project events',
                path: ['projectId'],
            });
        }
    }
}).refine((value) => {
    const end = new Date(value.endTime).getTime();
    const start = new Date(value.startTime).getTime();
    return value.isAllDay ? end >= start : end > start;
}, {
    message: 'End time must be after start time',
    path: ['endTime'],
});

export const updateEventSchema = z.object({
    scope: z.enum(['account', 'workspace', 'project']).optional(),
    source: z.enum(['manual', 'email', 'plugin']).optional(),
    calendarId: uuidSchema.optional(),
    workspaceId: uuidSchema.nullable().optional(),
    projectId: uuidSchema.nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    location: z.string().max(500).nullable().optional(),
    startTime: dateTimeSchema.optional(),
    endTime: dateTimeSchema.optional(),
    timezone: timezoneSchema.optional(),
    isAllDay: z.boolean().optional(),
    status: z.enum(['confirmed', 'cancelled']).optional(),
    conferenceProvider: conferenceProviderSchema.optional(),
    attendeeIds: z.array(uuidSchema).optional(),
    applyToSeries: z.boolean().optional(),
    seriesUpdateScope: seriesUpdateScopeSchema.optional(),
    seriesRecurrenceUntil: dateTimeSchema.nullable().optional(),
}).refine((value) => {
    // series scope modifiers are not content changes by themselves.
    const { applyToSeries, seriesUpdateScope, seriesRecurrenceUntil, ...fields } = value;
    void applyToSeries;
    void seriesUpdateScope;
    return Object.keys(fields).length > 0 || seriesRecurrenceUntil !== undefined;
}, {
    message: 'No fields to update',
}).refine((value) => {
    if (!value.startTime || !value.endTime) return true;
    const end = new Date(value.endTime).getTime();
    const start = new Date(value.startTime).getTime();
    return value.isAllDay ? end >= start : end > start;
}, {
    message: 'End time must be after start time',
    path: ['endTime'],
});
