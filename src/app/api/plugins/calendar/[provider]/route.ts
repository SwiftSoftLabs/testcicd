import { NextResponse } from 'next/server';

import { getUserFromRequest } from '@/lib/db';
import { parsePluginProviderParam } from '@/lib/plugins/calendar/oauth';
import {
    deleteCalendarPluginInstallation,
    deletePluginEventsForInstallation,
    findCalendarPluginInstallation,
} from '@/lib/plugins/calendar/repository';

export async function DELETE(request: Request, context: { params: Promise<{ provider: string }> }) {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try {
        const provider = parsePluginProviderParam((await context.params).provider);
        const installation = await findCalendarPluginInstallation(user.id, provider);
        if (installation) {
            await deletePluginEventsForInstallation(installation.id);
        }
        await deleteCalendarPluginInstallation(user.id, provider);
        return NextResponse.json({ ok: true });
    } catch (error: unknown) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid provider' }, { status: 400 });
    }
}
