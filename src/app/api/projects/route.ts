import { query, buildInsert, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import {
    WorkspaceAccessError,
    memberCan,
    requireSessionUser,
    requireWorkspaceMember,
    getWorkspaceMembership,
} from '@/lib/rbac/workspace-access';
import { checkProjectLimit } from '@/lib/billing/enforce';
import { evaluateQuotaGrace } from '@/lib/billing/reconcile';
import { PROJECT_KEY_RE, normalizeProjectKeyInput } from '@/lib/tasks/taskKey';
import { resolveUniqueProjectKey } from '@/lib/tasks/resolveUniqueProjectKey';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspaceId');

        if (!workspaceId || !UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
        }

        await requireWorkspaceMember(workspaceId, user.id);

        const result = await query(
            `SELECT * FROM ${SCHEMA}.projects WHERE workspace_id = $1 ORDER BY created_at DESC`,
            [workspaceId],
        );
        return NextResponse.json(result.rows);
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const body = await request.json() as {
            workspace_id?: string;
            name?: string;
            key?: string;
            [key: string]: unknown;
        };
        const workspaceId = body.workspace_id;

        if (!workspaceId || !UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
        }

        const membership = await requireWorkspaceMember(workspaceId, user.id);
        if (!memberCan(membership, 'create_projects')) {
            return NextResponse.json({ error: 'You do not have permission to create projects.' }, { status: 403 });
        }

        const limitCheck = await checkProjectLimit(workspaceId);
        if (!limitCheck.allowed) {
            return NextResponse.json({ error: limitCheck.error, code: limitCheck.code }, { status: 403 });
        }

        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
            return NextResponse.json({ error: 'name is required' }, { status: 400 });
        }

        let projectKey: string;
        if (body.key) {
            projectKey = normalizeProjectKeyInput(body.key);
            if (!PROJECT_KEY_RE.test(projectKey)) {
                return NextResponse.json(
                    { error: 'Project key must be 2–50 uppercase letters/numbers, starting with a letter' },
                    { status: 400 },
                );
            }
            const taken = await query(
                `SELECT 1 FROM ${SCHEMA}.projects
                 WHERE workspace_id = $1 AND upper(key) = $2 LIMIT 1`,
                [workspaceId, projectKey],
            );
            if (taken.rows.length > 0) {
                return NextResponse.json({ error: 'Project key already exists in this workspace' }, { status: 400 });
            }
        } else {
            projectKey = await resolveUniqueProjectKey(name, workspaceId);
        }

        const insertBody = { ...body, name, key: projectKey };
        const { sql, params } = buildInsert(`${SCHEMA}.projects`, insertBody);
        const result = await query(sql, params);
        const project = result.rows[0] as { id?: string } | undefined;

        if (project?.id) {
            await query(
                `INSERT INTO ${SCHEMA}.project_task_counters (project_id, next_number)
                 VALUES ($1, 1) ON CONFLICT DO NOTHING`,
                [project.id],
            );

            void import('@/lib/integrations/git/provisioning').then(({ ensureOneworkProjectRepo }) =>
                ensureOneworkProjectRepo({
                    workspaceId,
                    projectId: project.id!,
                    projectKey,
                    projectName: name,
                }),
            ).catch((err) => console.error('[onework-vc] project create provision:', err));
        }

        return NextResponse.json(result.rows[0]);
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });

        const projectRes = await query<{ workspace_id: string }>(
            `SELECT workspace_id FROM ${SCHEMA}.projects WHERE id = $1 LIMIT 1`,
            [id],
        );
        const workspaceId = projectRes.rows[0]?.workspace_id;
        if (!workspaceId) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        const membership = await getWorkspaceMembership(workspaceId, user.id);
        if (!membership || !memberCan(membership, 'delete_projects')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        await query(
            `WITH target_tasks AS (
                 SELECT id
                 FROM ${SCHEMA}.tasks
                 WHERE project_id = $1
             ),
             clear_parent_links AS (
                 UPDATE ${SCHEMA}.tasks
                 SET parent_task_id = NULL
                 WHERE parent_task_id IN (SELECT id FROM target_tasks)
                 RETURNING id
             ),
             delete_task_attachments AS (
                 DELETE FROM ${SCHEMA}.task_attachments
                 WHERE task_id IN (SELECT id FROM target_tasks)
                 RETURNING id
             ),
             delete_task_time_logs AS (
                 DELETE FROM ${SCHEMA}.task_time_logs
                 WHERE task_id IN (SELECT id FROM target_tasks)
                 RETURNING id
             ),
             delete_task_activities AS (
                 DELETE FROM ${SCHEMA}.task_activities
                 WHERE task_id IN (SELECT id FROM target_tasks)
                 RETURNING id
             ),
             delete_task_dependencies AS (
                 DELETE FROM ${SCHEMA}.task_dependencies
                 WHERE task_id IN (SELECT id FROM target_tasks)
                    OR depends_on_task_id IN (SELECT id FROM target_tasks)
                 RETURNING id
             ),
             delete_project_events AS (
                 DELETE FROM ${SCHEMA}.events
                 WHERE project_id = $1
                 RETURNING id
             ),
             delete_tasks AS (
                 DELETE FROM ${SCHEMA}.tasks
                 WHERE id IN (SELECT id FROM target_tasks)
                 RETURNING id
             )
             DELETE FROM ${SCHEMA}.projects
             WHERE id = $1`,
            [id],
        );
        await evaluateQuotaGrace(workspaceId);
        return NextResponse.json({ ok: true });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
