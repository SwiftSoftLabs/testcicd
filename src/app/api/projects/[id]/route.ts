import { query, buildSet, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import {
    WorkspaceAccessError,
    memberCan,
    requireSessionUser,
    getWorkspaceMembership,
} from '@/lib/rbac/workspace-access';
import { z } from 'zod';
import { PROJECT_KEY_RE, normalizeProjectKeyInput } from '@/lib/tasks/taskKey';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchProjectSchema = z.object({
    name: z.string().min(1, 'Name cannot be empty').optional(),
    description: z.string().max(500).nullable().optional(),
    color: z.string().regex(/^#[0-9a-f]{3,8}$/i, 'Invalid color format').optional(),
    key: z.string().min(2).max(10).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'No valid fields to update' });

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireSessionUser(request);
        const { id } = await params;

        if (!id || !UUID_RE.test(id)) {
            return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
        }

        const projectRes = await query<{ workspace_id: string; quota_locked: boolean }>(
            `SELECT workspace_id, quota_locked FROM ${SCHEMA}.projects WHERE id = $1 LIMIT 1`,
            [id],
        );
        const project = projectRes.rows[0];
        const workspaceId = project?.workspace_id;
        if (!workspaceId) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        const membership = await getWorkspaceMembership(workspaceId, user.id);
        if (!membership || !memberCan(membership, 'create_projects')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (project.quota_locked) {
            return NextResponse.json(
                { error: 'This project is read-only because your workspace is over its plan limit. Upgrade to restore access.', code: 'QUOTA_LOCKED' },
                { status: 403 },
            );
        }

        const raw = await request.json();
        const parsed = patchProjectSchema.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join('; ') }, { status: 400 });
        }

        const updateData: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };

        if (parsed.data.key !== undefined) {
            const normalizedKey = normalizeProjectKeyInput(parsed.data.key);
            if (!PROJECT_KEY_RE.test(normalizedKey)) {
                return NextResponse.json(
                    { error: 'Project key must be 2–50 uppercase letters/numbers, starting with a letter' },
                    { status: 400 },
                );
            }
            const taken = await query(
                `SELECT 1 FROM ${SCHEMA}.projects
                 WHERE workspace_id = $1 AND upper(key) = $2 AND id <> $3 LIMIT 1`,
                [workspaceId, normalizedKey, id],
            );
            if (taken.rows.length > 0) {
                return NextResponse.json({ error: 'Project key already exists in this workspace' }, { status: 400 });
            }
            updateData.key = normalizedKey;
        }

        const { clause, params: setParams } = buildSet(updateData);
        const result = await query(
            `UPDATE ${SCHEMA}.projects SET ${clause} WHERE id = $${setParams.length + 1} RETURNING *`,
            [...setParams, id],
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
