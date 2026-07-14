/**
 * PATCH /api/workspace/members/[id]/status
 * Updates profiles.status — own profile only.
 */

import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { requireSessionUser, WorkspaceAccessError } from '@/lib/rbac/workspace-access';

type Params = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uiStatusToDb(uiStatus: string): string | null {
    switch (uiStatus) {
        case 'Active':  return 'online';
        case 'Offline': return 'offline';
        case 'Away':    return 'away';
        case 'Invited': return 'invited';
        default:        return null;
    }
}

export async function PATCH(request: Request, { params }: Params) {
    try {
        const caller = await requireSessionUser(request);
        const { id: userId } = await params;

        if (!userId || !UUID_RE.test(userId)) {
            return NextResponse.json({ error: 'Missing or invalid user id' }, { status: 400 });
        }

        if (userId !== caller.id) {
            return NextResponse.json({ error: 'You can only update your own status.' }, { status: 403 });
        }

        let body: { status?: string };
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const dbStatus = uiStatusToDb(body.status || '');
        if (!dbStatus) {
            return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 400 });
        }

        const result = await query(
            `UPDATE ${SCHEMA}.profiles
             SET status = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING id, status`,
            [dbStatus, userId],
        );

        if (result.rowCount === 0) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        return NextResponse.json({ message: 'Status updated.' });
    } catch (error: unknown) {
        if (error instanceof WorkspaceAccessError) {
            const status = error.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: error.message }, { status });
        }
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
