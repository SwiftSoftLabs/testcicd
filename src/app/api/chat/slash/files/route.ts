import { NextResponse } from "next/server";
import { query, SCHEMA } from "@/lib/db";
import { requireSessionUser } from "@/lib/rbac/workspace-access";
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

    const result = await query<{
      id: string;
      file_name: string;
      file_type: string;
      file_size: number;
      storage_path: string;
    }>(
      `SELECT wf.id, wf.file_name, wf.file_type, wf.file_size, wf.storage_path
       FROM ${SCHEMA}.workspace_files wf
       INNER JOIN ${SCHEMA}.workspace_members wm
         ON wm.workspace_id = wf.workspace_id AND wm.user_id = $1
       WHERE wf.workspace_id = $2
         AND ($3 = '' OR wf.file_name ILIKE '%' || $3 || '%')
       ORDER BY wf.created_at DESC LIMIT 8`,
      [user.id, workspaceId, q],
    );

    return NextResponse.json({ data: result.rows });
  } catch (e: unknown) {
    const r = toAccessResponse(e);
    if (r) return r;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
