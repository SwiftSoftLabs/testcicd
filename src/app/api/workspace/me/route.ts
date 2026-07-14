/**
 * GET /api/workspace/me?userId=<uuid>
 * Returns all workspaces the user is a member of, ordered by creation date.
 */

import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await query(
      `SELECT w.id, w.name, w.slug, w.owner_id, w.created_at, wm.role
             FROM ${SCHEMA}.workspaces w
             JOIN ${SCHEMA}.workspace_members wm ON w.id = wm.workspace_id
             WHERE wm.user_id = $1
             ORDER BY w.created_at ASC`,
      [user.id],
    );

    return NextResponse.json({ data: result.rows });
  } catch (error: unknown) {
    console.error("Error fetching workspaces:", error);
    const msg =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
