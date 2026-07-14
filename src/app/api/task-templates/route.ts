import { query, buildInsert, buildSet, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import {
    memberCan,
    requireSessionUser,
    requireWorkspaceMember,
    WorkspaceAccessError,
} from '@/lib/rbac/workspace-access';
import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const templateFields = {
    name: z.string().min(1).optional(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    priority: z.string().optional(),
    tags: z.array(z.string()).optional(),
    default_assignee_id: z.string().uuid().nullable().optional(),
};

const postTemplateSchema = z.object({
    workspace_id: z.string().uuid('workspace_id must be a valid UUID'),
    ...templateFields,
});

const patchTemplateSchema = z.object({
    id: z.string().uuid('id required'),
    ...templateFields,
});

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspaceId');

        if (!workspaceId || !UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
        }

        await requireWorkspaceMember(workspaceId, user.id);

        const result = await query(
            `SELECT * FROM ${SCHEMA}.task_templates WHERE workspace_id = $1 ORDER BY created_at DESC`,
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
        const raw = await request.json();
        const parsed = postTemplateSchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join('; ') }, { status: 400 });
        }

        const { workspace_id: workspaceId, ...fields } = parsed.data;

        const membership = await requireWorkspaceMember(workspaceId, user.id);
        if (!memberCan(membership, 'manage_workflows')) {
            return NextResponse.json({ error: 'You do not have permission to manage task templates.' }, { status: 403 });
        }

        const { sql, params } = buildInsert(`${SCHEMA}.task_templates`, { workspace_id: workspaceId, ...fields, created_by: user.id });
        const result = await query(sql, params);
        return NextResponse.json(result.rows[0]);
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const raw = await request.json();
        const parsed = patchTemplateSchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join('; ') }, { status: 400 });
        }

        const { id, ...fields } = parsed.data;

        const templateRes = await query<{ workspace_id: string }>(
            `SELECT workspace_id FROM ${SCHEMA}.task_templates WHERE id = $1 LIMIT 1`,
            [id],
        );
        const workspaceId = templateRes.rows[0]?.workspace_id;
        if (!workspaceId) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }

        const membership = await requireWorkspaceMember(workspaceId, user.id);
        if (!memberCan(membership, 'manage_workflows')) {
            return NextResponse.json({ error: 'You do not have permission to manage task templates.' }, { status: 403 });
        }

        const { clause, params, nextIdx } = buildSet(fields as Record<string, unknown>);
        const result = await query(
            `UPDATE ${SCHEMA}.task_templates SET ${clause} WHERE id = $${nextIdx} RETURNING *`,
            [...params, id],
        );
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

        if (!id || !UUID_RE.test(id)) {
            return NextResponse.json({ error: 'id required' }, { status: 400 });
        }

        const templateRes = await query<{ workspace_id: string }>(
            `SELECT workspace_id FROM ${SCHEMA}.task_templates WHERE id = $1 LIMIT 1`,
            [id],
        );
        const workspaceId = templateRes.rows[0]?.workspace_id;
        if (!workspaceId) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }

        const membership = await requireWorkspaceMember(workspaceId, user.id);
        if (!memberCan(membership, 'manage_workflows')) {
            return NextResponse.json({ error: 'You do not have permission to manage task templates.' }, { status: 403 });
        }

        await query(`DELETE FROM ${SCHEMA}.task_templates WHERE id = $1`, [id]);
        return NextResponse.json({ success: true });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
