import { NextResponse } from "next/server";
import { query, SCHEMA } from "@/lib/db";
import { requireSessionUser } from "@/lib/rbac/workspace-access";
import { requireWorkspaceTasksRead } from "@/lib/rbac/task-access";
import { toAccessResponse } from "@/lib/rbac/http";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const q = (searchParams.get("q") ?? "").trim();

    if (!workspaceId || !UUID_RE.test(workspaceId))
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    await requireWorkspaceTasksRead(workspaceId, user.id);

    const result = await query<{ id: string; title: string; status: string; priority: string; project_name: string | null }>(
      `SELECT t.id, t.title, t.status::text, t.priority::text, p.name AS project_name
       FROM ${SCHEMA}.tasks t
       LEFT JOIN ${SCHEMA}.projects p ON p.id = t.project_id
       WHERE t.workspace_id = $1
         AND ($2 = '' OR t.title ILIKE '%' || $2 || '%')
       ORDER BY t.updated_at DESC LIMIT 8`,
      [workspaceId, q],
    );

    return NextResponse.json({ data: result.rows });
  } catch (e: unknown) {
    const r = toAccessResponse(e);
    if (r) return r;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
