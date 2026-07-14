import { NextResponse } from 'next/server';
import { query, SCHEMA } from '@/lib/db';
import { z } from 'zod';
import {
    requireSessionUser,
    requireWorkspaceMember,
    WorkspaceAccessError,
} from '@/lib/rbac/workspace-access';

interface TeamRow {
    id: string;
    name: string;
    description: string | null;
    lead_id: string | null;
    member_ids: string[] | string | null;
}

const querySchema = z.object({
    workspaceId: z.string().uuid('Missing or invalid workspaceId'),
});

function isMissingRelationError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return error.message.includes(`${SCHEMA}.teams`) || error.message.includes(`${SCHEMA}.team_members`);
}

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const parsed = querySchema.safeParse({
            workspaceId: searchParams.get('workspaceId'),
        });

        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') }, { status: 400 });
        }

        const { workspaceId } = parsed.data;
        await requireWorkspaceMember(workspaceId, user.id);

        const result = await query<TeamRow>(
            `SELECT
                t.id,
                t.name,
                t.description,
                t.lead_id,
                COALESCE(json_agg(tm.user_id::text) FILTER (WHERE tm.user_id IS NOT NULL), '[]'::json) AS member_ids
            FROM ${SCHEMA}.teams t
            LEFT JOIN ${SCHEMA}.team_members tm ON tm.team_id = t.id
            WHERE t.workspace_id = $1
            GROUP BY t.id
            ORDER BY t.name`,
            [workspaceId],
        );

        const data = result.rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description || '',
            leadId: row.lead_id || '',
            memberIds: Array.isArray(row.member_ids)
                ? row.member_ids
                : typeof row.member_ids === 'string'
                    ? (row.member_ids as string).replace(/^{|}$/g, '').split(',').filter(Boolean)
                    : [],
            members: Array.isArray(row.member_ids)
                ? row.member_ids.length
                : typeof row.member_ids === 'string'
                    ? (row.member_ids as string).replace(/^{|}$/g, '').split(',').filter(Boolean).length
                    : 0,
        }));

        return NextResponse.json(data);
    } catch (error: unknown) {
        if (error instanceof WorkspaceAccessError) {
            const status = error.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: error.message }, { status });
        }
        if (isMissingRelationError(error)) {
            return NextResponse.json([]);
        }
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
