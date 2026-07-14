import { query, SCHEMA } from '@/lib/db';
import { NextResponse } from 'next/server';
import {
    requireSessionUser,
    requireWorkspaceMember,
    WorkspaceAccessError,
} from '@/lib/rbac/workspace-access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY = { tasks: [], projects: [], users: [], conversations: [], emails: [], files: [] };

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const q = searchParams.get('q');
        const workspaceId = searchParams.get('workspaceId');

        if (!q || !workspaceId) {
            return NextResponse.json(EMPTY);
        }

        if (!UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'Invalid workspaceId' }, { status: 400 });
        }

        await requireWorkspaceMember(workspaceId, user.id);

        const pattern = `%${q}%`;

        const [tasksRes, projectsRes, membersRes, conversationsRes, emailsRes, filesRes] = await Promise.all([
            query(
                `SELECT DISTINCT t.id, t.title, t.description, t.status, t.priority, t.task_key
                 FROM ${SCHEMA}.tasks t
                 LEFT JOIN ${SCHEMA}.task_key_aliases a
                   ON a.task_id = t.id AND a.workspace_id = t.workspace_id
                 WHERE t.workspace_id = $1
                   AND (
                     t.title ILIKE $2
                     OR t.description ILIKE $2
                     OR t.task_key ILIKE $2
                     OR a.task_key ILIKE $2
                   )
                 LIMIT 5`,
                [workspaceId, pattern],
            ),
            query(
                `SELECT id, name, description, color
                 FROM ${SCHEMA}.projects
                 WHERE workspace_id = $1 AND (name ILIKE $2 OR description ILIKE $2)
                 LIMIT 5`,
                [workspaceId, pattern],
            ),
            query(
                `SELECT p.id, p.full_name, p.email, p.avatar_url
                 FROM ${SCHEMA}.workspace_members wm
                 JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
                 WHERE wm.workspace_id = $1 AND (p.full_name ILIKE $2 OR p.email ILIKE $2)
                 LIMIT 5`,
                [workspaceId, pattern],
            ),
            query(
                `SELECT c.id, c.name, c.type, c.description
                 FROM ${SCHEMA}.conversations c
                 INNER JOIN ${SCHEMA}.conversation_members cm
                   ON cm.conversation_id = c.id
                  AND cm.user_id = $2
                  AND cm.left_at IS NULL
                 WHERE c.workspace_id = $1
                   AND c.name IS NOT NULL
                   AND c.name ILIKE $3
                 LIMIT 5`,
                [workspaceId, user.id, pattern],
            ),
            query(
                `SELECT id, subject, from_json, received_at, is_read
                 FROM ${SCHEMA}.mail_messages
                 WHERE workspace_id = $1
                   AND (
                     subject ILIKE $2
                     OR from_json->>'name' ILIKE $2
                     OR from_json->>'address' ILIKE $2
                     OR COALESCE(text_body, '') ILIKE $2
                     OR COALESCE(html_body, '') ILIKE $2
                   )
                 ORDER BY received_at DESC
                 LIMIT 5`,
                [workspaceId, pattern],
            ),
            query(
                `SELECT id, file_name, file_type, file_size, folder_id, created_at
                 FROM ${SCHEMA}.workspace_files
                 WHERE workspace_id = $1 AND file_name ILIKE $2
                 LIMIT 5`,
                [workspaceId, pattern],
            ),
        ]);

        return NextResponse.json({
            tasks: tasksRes.rows,
            projects: projectsRes.rows,
            users: membersRes.rows,
            conversations: conversationsRes.rows,
            emails: emailsRes.rows,
            files: filesRes.rows,
        });
    } catch (e: unknown) {
        if (e instanceof WorkspaceAccessError) {
            const status = e.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: e.message }, { status });
        }
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
