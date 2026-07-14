import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/db";
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";
import {
  getWorkspaceUserSettings,
  saveWorkspaceUserSettings,
} from "@/lib/workspace-user-settings";

const workspaceIdSchema = z.string().uuid();

const putBodySchema = z.object({
  workspaceId: z.string().uuid(),
  developerMode: z.boolean().optional(),
  showOfflineStatus: z.boolean().optional(),
  quickTaskbarPinned: z.boolean().optional(),
});

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceIdResult = workspaceIdSchema.safeParse(
    searchParams.get("workspaceId"),
  );
  if (!workspaceIdResult.success) {
    return NextResponse.json(
      { error: "Missing or invalid workspaceId" },
      { status: 400 },
    );
  }
  const workspaceId = workspaceIdResult.data;

  if (!(await isWorkspaceMember(workspaceId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const settings = await getWorkspaceUserSettings(workspaceId, user.id);
    return NextResponse.json(settings);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to fetch workspace settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await request.json().catch(() => null);
  const bodyResult = putBodySchema.safeParse(rawBody);
  if (!bodyResult.success) {
    return NextResponse.json(
      { error: bodyResult.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  const { workspaceId, ...updates } = bodyResult.data;

  if (!(await isWorkspaceMember(workspaceId, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const settings = await saveWorkspaceUserSettings(
      workspaceId,
      user.id,
      updates,
    );
    return NextResponse.json(settings);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to save workspace settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
