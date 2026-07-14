import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import {
    WorkspaceAccessError,
    getWorkspaceMembership,
    memberCan,
    requireSessionUser,
} from '@/lib/rbac/workspace-access';

const PREVIEW_LIMIT = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProjectRow = {
    id: string;
    name: string;
};

type TaskRow = {
    id: string;
    title: string;
};

type EventRow = {
    id: string;
    title: string;
};

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
        if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });

        const projectRes = await query<ProjectRow & { workspace_id: string }>(
            `SELECT id, name, workspace_id FROM ${SCHEMA}.projects WHERE id = $1 LIMIT 1`,
            [id],
        );
        const project = projectRes.rows[0];
        if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

        const membership = await getWorkspaceMembership(project.workspace_id, user.id);
        if (!membership || !memberCan(membership, 'delete_projects')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const [taskCountRes, tasksRes, eventCountRes, eventsRes] = await Promise.all([
            query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${SCHEMA}.tasks WHERE project_id = $1`, [id]),
            query<TaskRow>(
                `SELECT id, title
                 FROM ${SCHEMA}.tasks
                 WHERE project_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [id, PREVIEW_LIMIT],
            ),
            query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${SCHEMA}.events WHERE project_id = $1`, [id]),
            query<EventRow>(
                `SELECT id, title
                 FROM ${SCHEMA}.events
                 WHERE project_id = $1
                 ORDER BY start_time DESC, created_at DESC
                 LIMIT $2`,
                [id, PREVIEW_LIMIT],
            ),
        ]);

        return NextResponse.json({
            project: { id: project.id, name: project.name },
            sections: [
                {
                    label: 'Tasks to delete',
                    count: Number(taskCountRes.rows[0]?.count || 0),
                    items: tasksRes.rows.map((row) => ({ id: row.id, label: row.title || '(Untitled task)' })),
                    emptyMessage: 'No tasks in this project.',
                },
                {
                    label: 'Project events to delete',
                    count: Number(eventCountRes.rows[0]?.count || 0),
                    items: eventsRes.rows.map((row) => ({ id: row.id, label: row.title || '(Untitled event)' })),
                    emptyMessage: 'No events in this project.',
                },
            ],
            previewLimit: PREVIEW_LIMIT,
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
