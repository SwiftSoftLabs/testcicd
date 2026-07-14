/**
 * GET /api/workspace/members/[id]/delete-impact?workspaceId=<uuid>
 *   Returns tasks in this workspace assigned to the user (workspace removal scope).
 *
 * GET /api/workspace/members/[id]/delete-impact?workspaceId=<uuid>&scope=account
 *   Returns all workspaces the user is in + all tasks assigned to them (full account deletion scope).
 */

import { NextResponse } from 'next/server';
import { getUserFromRequest, query, SCHEMA } from '@/lib/db';
import { getWorkspaceMembership, memberCan } from '@/lib/rbac/workspace-access';

const PREVIEW_LIMIT = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

interface WorkspaceRow {
    id: string;
    name: string;
}

interface TaskRow {
    id: string;
    title: string;
}

export async function GET(request: Request, { params }: Params) {
    const caller = await getUserFromRequest(request);
    if (!caller?.id || !UUID_RE.test(caller.id)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: targetUserId } = await params;
    if (!targetUserId || !UUID_RE.test(targetUserId)) {
        return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    const scope = searchParams.get('scope'); // 'account' or omitted (workspace)

    if (!workspaceId || !UUID_RE.test(workspaceId)) {
        return NextResponse.json({ error: 'Missing or invalid workspaceId' }, { status: 400 });
    }

    const callerMembership = await getWorkspaceMembership(workspaceId, caller.id);
    if (!callerMembership) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (scope === 'account' && !callerMembership.isOwner) {
        return NextResponse.json({ error: 'Only the workspace owner can preview account deletion.' }, { status: 403 });
    }

    if (scope !== 'account' && !memberCan(callerMembership, 'manage_members')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        if (scope === 'account') {
            // Full account deletion impact: all workspaces + all tasks across workspaces
            const [workspacesCountRes, tasksCountRes, workspacesRes, tasksRes] = await Promise.all([
                query<{ count: string }>(
                    `SELECT COUNT(*)::text AS count
                     FROM ${SCHEMA}.workspace_members
                     WHERE user_id = $1`,
                    [targetUserId],
                ),
                query<{ count: string }>(
                    `SELECT COUNT(*)::text AS count
                     FROM ${SCHEMA}.tasks
                     WHERE assignee_id = $1`,
                    [targetUserId],
                ),
                query<WorkspaceRow>(
                    `SELECT w.id, w.name
                     FROM ${SCHEMA}.workspace_members wm
                     JOIN ${SCHEMA}.workspaces w ON w.id = wm.workspace_id
                     WHERE wm.user_id = $1
                     ORDER BY w.name
                     LIMIT $2`,
                    [targetUserId, PREVIEW_LIMIT],
                ),
                query<TaskRow>(
                    `SELECT id, title
                     FROM ${SCHEMA}.tasks
                     WHERE assignee_id = $1
                     ORDER BY created_at DESC
                     LIMIT $2`,
                    [targetUserId, PREVIEW_LIMIT],
                ),
            ]);

            return NextResponse.json({
                sections: [
                    {
                        label: 'Workspaces losing this member',
                        count: Number(workspacesCountRes.rows[0]?.count || 0),
                        items: workspacesRes.rows.map((r) => ({ id: r.id, label: r.name })),
                        emptyMessage: 'Not a member of any workspace.',
                    },
                    {
                        label: 'Tasks that will become unassigned',
                        count: Number(tasksCountRes.rows[0]?.count || 0),
                        items: tasksRes.rows.map((r) => ({ id: r.id, label: r.title || '(Untitled task)' })),
                        emptyMessage: 'No tasks assigned to this user.',
                    },
                ],
                previewLimit: PREVIEW_LIMIT,
            });
        }

        // Workspace-scope removal impact: tasks in this workspace only
        const [tasksCountRes, tasksRes] = await Promise.all([
            query<{ count: string }>(
                `SELECT COUNT(*)::text AS count
                 FROM ${SCHEMA}.tasks
                 WHERE assignee_id = $1
                   AND workspace_id = $2`,
                [targetUserId, workspaceId],
            ),
            query<TaskRow>(
                `SELECT id, title
                 FROM ${SCHEMA}.tasks
                 WHERE assignee_id = $1
                   AND workspace_id = $2
                 ORDER BY created_at DESC
                 LIMIT $3`,
                [targetUserId, workspaceId, PREVIEW_LIMIT],
            ),
        ]);

        return NextResponse.json({
            sections: [
                {
                    label: 'Tasks that will become unassigned',
                    count: Number(tasksCountRes.rows[0]?.count || 0),
                    items: tasksRes.rows.map((r) => ({ id: r.id, label: r.title || '(Untitled task)' })),
                    emptyMessage: 'No tasks assigned to this user in this workspace.',
                },
            ],
            previewLimit: PREVIEW_LIMIT,
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
