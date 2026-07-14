/**
 * PATCH /api/profile/presence  — fetch-based presence updates (online / away / manual)
 * POST  /api/profile/presence  — sendBeacon tab-close offline
 *
 * Auth: reads sb-access-token cookie via getUserFromRequest.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";
import {
  deactivateUserPresence,
  syncAutoUserPresence,
} from "@/lib/presence/sync-presence";

const presenceBodySchema = z.object({
  status: z.enum(["online", "offline", "away"]).optional(),
  workspaceId: z.string().uuid().nullish(),
  manual: z.boolean().optional(),
});

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.clone().json();
  } catch {
    try {
      const text = await request.text();
      if (!text) return {};
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
}

async function handlePresence(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await parseBody(request);
  const parsed = presenceBodySchema.safeParse(raw);
  const body = parsed.success ? parsed.data : {};
  const status = body.status ?? "online";
  const workspaceId = body.workspaceId ?? null;
  const manual = body.manual ?? false;

  try {
    if (manual) {
      if (!workspaceId || !(await isWorkspaceMember(workspaceId, user.id))) {
        return NextResponse.json(
          { error: "workspaceId is required for manual presence" },
          { status: 400 },
        );
      }

      await query(
        `INSERT INTO ${SCHEMA}.workspace_presence (workspace_id, user_id, status, is_manual, updated_at)
                     VALUES ($1, $2, $3, $4, NOW())
                     ON CONFLICT (workspace_id, user_id) DO UPDATE
                     SET status = EXCLUDED.status,
                         is_manual = EXCLUDED.is_manual,
                         updated_at = NOW()`,
        [workspaceId, user.id, status, status !== "online"],
      );

      await query(
        `UPDATE ${SCHEMA}.profiles SET status = $1, updated_at = NOW() WHERE id = $2`,
        [status, user.id],
      );
    } else {
      await syncAutoUserPresence(user.id, status);
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const PATCH = handlePresence;

/** Tab/browser close — same offline semantics as logout presence. */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    await deactivateUserPresence(user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error: unknown) {
    console.error("[presence] beacon offline failed:", error);
    return new NextResponse(null, { status: 500 });
  }
}
