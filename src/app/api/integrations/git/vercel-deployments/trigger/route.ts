import { NextResponse } from "next/server";
import { z } from "zod";

import { getVercelDeploymentLinkForRepo } from "@/lib/integrations/git/git-repo-vercel-deployments-repository";
import { requireVercelCicdAccess } from "@/lib/integrations/git/vercel-cicd-access";
import { triggerVercelDeployForLink } from "@/lib/integrations/git/vercel-cicd";
import {
  requireSessionUser,
  WorkspaceAccessError,
} from "@/lib/rbac/workspace-access";

const triggerSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1).optional(),
  sha: z.string().min(7).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json();
    const parsed = triggerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const { workspaceId, projectId, owner, repo, branch, sha } = parsed.data;
    await requireVercelCicdAccess(workspaceId, user.id);

    const link = await getVercelDeploymentLinkForRepo(projectId, `${owner}/${repo}`);
    if (!link?.enabled) {
      return NextResponse.json(
        { error: "CI/CD is not configured for this repository" },
        { status: 404 },
      );
    }

    const deployBranch = branch?.trim() || link.production_branch;
    const deploySha = sha?.trim();
    if (!deploySha) {
      return NextResponse.json(
        { error: "sha is required for manual redeploy" },
        { status: 400 },
      );
    }

    const result = await triggerVercelDeployForLink({
      link,
      branch: deployBranch,
      sha: deploySha,
    });

    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof WorkspaceAccessError) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status ?? 403 },
      );
    }
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[vercel-deployments/trigger POST]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
