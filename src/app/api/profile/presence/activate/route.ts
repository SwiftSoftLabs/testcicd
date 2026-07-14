/**
 * POST /api/profile/presence/activate
 * Sets the authenticated user online across all workspaces (login / session restore).
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/db';
import { activateUserPresence } from '@/lib/presence/sync-presence';

export async function POST(request: Request) {
    const user = await getUserFromRequest(request);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        await activateUserPresence(user.id);
        return NextResponse.json({ ok: true });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
