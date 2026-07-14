import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getUserFromRequest } from '@/lib/db';
import { parsePluginProviderParam } from '@/lib/plugins/calendar/oauth';
import {
    findCalendarPluginInstallation,
    updateInstallationSettings,
} from '@/lib/plugins/calendar/repository';

const bodySchema = z.object({
    calendarIds: z.array(z.string()).optional(),
    userUri: z.string().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ provider: string }> }) {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    try {
        const provider = parsePluginProviderParam((await context.params).provider);
        const installation = await findCalendarPluginInstallation(user.id, provider);
        if (!installation) return NextResponse.json({ error: 'Plugin not connected' }, { status: 404 });

        const nextSettings = {
            ...(installation.settings ?? {}),
            ...parsed.data,
        };
        await updateInstallationSettings(installation.id, nextSettings);
        return NextResponse.json({ ok: true, settings: nextSettings });
    } catch (error: unknown) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid provider' }, { status: 400 });
    }
}
