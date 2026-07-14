import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  workspace_id: z.string().uuid(),
  who_can_start_calls: z.enum(["all_members", "admins_only"]).optional(),
  call_recording_retention_days: z.number().int().min(1).max(3650).optional(),
  call_ai_enabled_default: z.boolean().optional(),
  call_noise_cancellation_default: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { workspace_id, ...fields } = parsed.data;
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const member = await query<{ role: string }>(
    `SELECT role FROM ${SCHEMA}.workspace_members
     WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
    [workspace_id, user.id],
  );
  if (!member.rows[0]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const role = member.rows[0].role?.toLowerCase() ?? "";
  const owner = await query<{ ok: number }>(
    `SELECT 1 AS ok FROM ${SCHEMA}.workspaces
     WHERE id = $1 AND owner_id = $2 LIMIT 1`,
    [workspace_id, user.id],
  );
  const isAdmin = role === "admin" || owner.rows.length > 0;
  if (!isAdmin) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (fields.who_can_start_calls !== undefined) {
    patch.who_can_start_calls = fields.who_can_start_calls;
  }
  if (fields.call_recording_retention_days !== undefined) {
    patch.call_recording_retention_days = fields.call_recording_retention_days;
  }
  if (fields.call_ai_enabled_default !== undefined) {
    patch.call_ai_enabled_default = fields.call_ai_enabled_default;
  }
  if (fields.call_noise_cancellation_default !== undefined) {
    patch.call_noise_cancellation_default =
      fields.call_noise_cancellation_default;
  }

  const res = await query<{ settings: Record<string, unknown> }>(
    `UPDATE ${SCHEMA}.workspaces
     SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1
     RETURNING settings`,
    [workspace_id, JSON.stringify(patch)],
  );

  return NextResponse.json({ settings: res.rows[0]?.settings ?? patch });
}

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId required" },
      { status: 400 },
    );
  }

  const member = await query(
    `SELECT 1 FROM ${SCHEMA}.workspace_members
     WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
    [workspaceId, user.id],
  );
  if (!member.rows[0]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const res = await query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM ${SCHEMA}.workspaces WHERE id = $1 LIMIT 1`,
    [workspaceId],
  );

  return NextResponse.json({
    settings: res.rows[0]?.settings ?? {},
  });
}
