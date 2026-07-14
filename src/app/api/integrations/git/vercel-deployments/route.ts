import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getVercelDeploymentStatus,
  setupOneworkVcVercelCicd,
  teardownOneworkVcVercelCicd,
} from "@/lib/integrations/git/vercel-cicd";
import { requireVercelCicdAccess } from "@/lib/integrations/git/vercel-cicd-access";
import {
  requireSessionUser,
  requireWorkspaceMember,
  WorkspaceAccessError,
} from "@/lib/rbac/workspace-access";

const setupSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  productionBranch: z.string().min(1).optional(),
  vercelProjectName: z.string().min(1).max(100).optional(),
  vercelProjectId: z.string().min(1).optional(),
});

const deleteSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const projectId = searchParams.get("projectId");
    const owner = searchParams.get("owner");
    const repo = searchParams.get("repo");

    if (!workspaceId || !projectId || !owner || !repo) {
      return NextResponse.json(
        { error: "workspaceId, projectId, owner, and repo are required" },
        { status: 400 },
      );
    }

    await requireWorkspaceMember(workspaceId, user.id);

    const status = await getVercelDeploymentStatus({
      projectId,
      workspaceId,
      owner,
      repo,
    });

    return NextResponse.json({ data: status });
  } catch (e) {
    if (e instanceof WorkspaceAccessError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    console.error("[vercel-deployments GET]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json();
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { workspaceId, projectId, productionBranch, vercelProjectName, vercelProjectId } =
      parsed.data;

    await requireVercelCicdAccess(workspaceId, user.id);

    const link = await setupOneworkVcVercelCicd({
      projectId,
      workspaceId,
      actorId: user.id,
      productionBranch,
      vercelProjectName,
      vercelProjectId,
    });

    return NextResponse.json({ data: link }, { status: 201 });
  } catch (e) {
    if (e instanceof WorkspaceAccessError) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status ?? 403 },
      );
    }
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[vercel-deployments POST]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json();
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { workspaceId, projectId, owner, repo } = parsed.data;
    await requireVercelCicdAccess(workspaceId, user.id);

    await teardownOneworkVcVercelCicd({
      projectId,
      workspaceId,
      repoFullName: `${owner}/${repo}`,
    });

    return NextResponse.json({ data: { disconnected: true } });
  } catch (e) {
    if (e instanceof WorkspaceAccessError) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status ?? 403 },
      );
    }
    console.error("[vercel-deployments DELETE]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
