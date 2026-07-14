import { NextResponse } from 'next/server';
import { z } from 'zod';

import { query, SCHEMA } from '@/lib/db';
import { requireWorkspaceTasksWrite } from '@/lib/rbac/task-access';
import {
    createProjectLink,
    deleteProjectLink,
    findTaskPluginInstallation,
    listProjectLinks,
} from '@/lib/plugins/tasks/repository';
import { syncProjectLink } from '@/lib/plugins/tasks/sync-engine';
import { toAccessResponse } from '@/lib/rbac/http';
import { requireSessionUser } from '@/lib/rbac/workspace-access';

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const workspaceId = new URL(request.url).searchParams.get('workspaceId');
        if (!workspaceId) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }
        await requireWorkspaceTasksWrite(workspaceId, user.id);
        const links = await listProjectLinks(workspaceId);
        return NextResponse.json({ links });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        return NextResponse.json({ error: 'Failed to list links' }, { status: 500 });
    }
}

const postSchema = z.object({
    workspaceId: z.string().uuid(),
    provider: z.enum(['trello', 'jira', 'clickup', 'asana']),
    projectId: z.string().uuid().nullable().optional(),
    externalContainerId: z.string().min(1),
    externalContainerName: z.string().optional(),
});

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const parsed = postSchema.parse(await request.json());
        await requireWorkspaceTasksWrite(parsed.workspaceId, user.id);

        const installation = await findTaskPluginInstallation(parsed.workspaceId, parsed.provider);
        if (!installation) {
            return NextResponse.json({ error: `Connect ${parsed.provider} first` }, { status: 400 });
        }

        if (parsed.projectId) {
            const proj = await query<{ id: string }>(
                `SELECT id FROM ${SCHEMA}.projects WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
                [parsed.projectId, parsed.workspaceId],
            );
            if (!proj.rows[0]) {
                return NextResponse.json({ error: 'Project not found in workspace' }, { status: 404 });
            }
        }

        const link = await createProjectLink({
            installationId: installation.id,
            projectId: parsed.projectId ?? null,
            externalContainerId: parsed.externalContainerId,
            externalContainerName: parsed.externalContainerName ?? null,
        });

        const syncResult = await syncProjectLink(installation, link);

        return NextResponse.json(
            { ok: true, link, imported: syncResult.imported, updated: syncResult.updated },
            { status: 201 },
        );
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        const msg = error instanceof Error ? error.message : 'Failed to create link';
        const status = msg.includes('duplicate') || msg.includes('unique') ? 409 : 500;
        return NextResponse.json({ error: msg }, { status });
    }
}

export async function DELETE(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const linkId = new URL(request.url).searchParams.get('linkId');
        const workspaceId = new URL(request.url).searchParams.get('workspaceId');
        if (!linkId || !workspaceId) {
            return NextResponse.json({ error: 'linkId and workspaceId are required' }, { status: 400 });
        }
        await requireWorkspaceTasksWrite(workspaceId, user.id);
        await deleteProjectLink(linkId);
        return NextResponse.json({ ok: true });
    } catch (error: unknown) {
        const access = toAccessResponse(error);
        if (access) return access;
        return NextResponse.json({ error: 'Failed to delete link' }, { status: 500 });
    }
}
