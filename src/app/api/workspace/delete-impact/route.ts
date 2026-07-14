import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";

const PREVIEW_LIMIT = 8;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NamedRow = {
  id: string;
  name: string;
};

type TaskRow = {
  id: string;
  title: string;
};

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user?.id || !UUID_RE.test(user.id))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id)
    return NextResponse.json(
      { error: "Workspace ID is required" },
      { status: 400 },
    );
  if (!UUID_RE.test(id))
    return NextResponse.json(
      { error: "Invalid workspace ID" },
      { status: 400 },
    );

  try {
    const access = await query<{ id: string; name: string }>(
      `SELECT w.id, w.name
             FROM ${SCHEMA}.workspaces w
             LEFT JOIN ${SCHEMA}.workspace_members wm
               ON wm.workspace_id = w.id
              AND wm.user_id = $2
             WHERE w.id = $1
               AND w.owner_id = $2
             LIMIT 1`,
      [id, user.id],
    );
    const workspace = access.rows[0];
    if (!workspace)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [
      projectCountRes,
      taskCountRes,
      memberCountRes,
      projectsRes,
      tasksRes,
      membersRes,
    ] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${SCHEMA}.projects WHERE workspace_id = $1`,
        [id],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${SCHEMA}.tasks WHERE workspace_id = $1`,
        [id],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${SCHEMA}.workspace_members WHERE workspace_id = $1`,
        [id],
      ),
      query<NamedRow>(
        `SELECT id, name
                 FROM ${SCHEMA}.projects
                 WHERE workspace_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2`,
        [id, PREVIEW_LIMIT],
      ),
      query<TaskRow>(
        `SELECT id, title
                 FROM ${SCHEMA}.tasks
                 WHERE workspace_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2`,
        [id, PREVIEW_LIMIT],
      ),
      query<NamedRow>(
        `SELECT p.id, COALESCE(NULLIF(p.full_name, ''), p.email, 'Unknown Member') AS name
                 FROM ${SCHEMA}.workspace_members wm
                 LEFT JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
                 WHERE wm.workspace_id = $1
                 ORDER BY p.updated_at DESC NULLS LAST, p.id DESC
                 LIMIT $2`,
        [id, PREVIEW_LIMIT],
      ),
    ]);

    return NextResponse.json({
      workspace: { id: workspace.id, name: workspace.name },
      sections: [
        {
          label: "Projects to delete",
          count: Number(projectCountRes.rows[0]?.count || 0),
          items: projectsRes.rows.map((row) => ({
            id: row.id,
            label: row.name,
          })),
          emptyMessage: "No projects in this workspace.",
        },
        {
          label: "Tasks to delete",
          count: Number(taskCountRes.rows[0]?.count || 0),
          items: tasksRes.rows.map((row) => ({
            id: row.id,
            label: row.title || "(Untitled task)",
          })),
          emptyMessage: "No tasks in this workspace.",
        },
        {
          label: "Members losing workspace access",
          count: Number(memberCountRes.rows[0]?.count || 0),
          items: membersRes.rows.map((row) => ({
            id: row.id,
            label: row.name,
          })),
          emptyMessage: "No member access to remove.",
        },
      ],
      previewLimit: PREVIEW_LIMIT,
    });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
