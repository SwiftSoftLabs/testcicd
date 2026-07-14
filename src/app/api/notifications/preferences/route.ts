import { NextResponse } from 'next/server';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import {
    getNotificationPreferences,
    saveNotificationPreferences,
} from '@/lib/notification-preferences';
import { NotificationPreferences } from '@/types';

function parsePreferencePayload(raw: unknown): { data?: Partial<NotificationPreferences>; error?: string } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: 'Invalid JSON body' };
    }

    const allowedKeys: Array<keyof NotificationPreferences> = [
        'globalDnd',
        'browserNotifications',
        'taskAssignments',
        'taskComments',
        'taskStatusChanges',
        'pullRequestActivity',
        'buildStatus',
        'securityAlerts',
        'newEmails',
        'fileUploads',
        'callInvites',
        'callReminders',
        'callSummaries',
        'callMeetingTasksReview',
        'calendarEmailEvents',
        'calendarEventInvites',
        'calendarEventInviteEmail',
    ];

    const body = raw as Record<string, unknown>;
    const updates: Partial<NotificationPreferences> = {};

    for (const key of Object.keys(body)) {
        if (!allowedKeys.includes(key as keyof NotificationPreferences)) {
            return { error: `Unsupported field: ${key}` };
        }
        if (typeof body[key] !== 'boolean') {
            return { error: `${key} must be boolean` };
        }
        updates[key as keyof NotificationPreferences] = body[key] as boolean;
    }

    if (Object.keys(updates).length === 0) {
        return { error: 'No valid preference fields supplied' };
    }

    return { data: updates };
}

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const data = await getNotificationPreferences(user.id);
        return NextResponse.json(data);
    } catch (error: unknown) {
        if (error instanceof WorkspaceAccessError) {
            const status = error.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: error.message }, { status });
        }
        const message = error instanceof Error ? error.message : 'Failed to fetch notification preferences';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const body = await request.json().catch(() => null);
        const parsed = parsePreferencePayload(body);
        if (parsed.error) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }

        const data = await saveNotificationPreferences(user.id, parsed.data!);
        return NextResponse.json(data);
    } catch (error: unknown) {
        if (error instanceof WorkspaceAccessError) {
            const status = error.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: error.message }, { status });
        }
        const message = error instanceof Error ? error.message : 'Failed to save notification preferences';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
