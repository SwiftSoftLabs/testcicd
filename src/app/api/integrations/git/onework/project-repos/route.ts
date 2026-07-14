import { NextResponse } from "next/server";
import { z } from "zod";

import { assertProjectWritable } from "@/lib/billing/quota-locks";
import { getPlatformRepoForProject } from "@/lib/integrations/git/platform-repos-repository";
import { ensureOneworkProjectRepo } from "@/lib/integrations/git/provisioning";
import { isOneworkVcConfigured } from "@/lib/integrations/git/onework";
import { oneworkProjectRepoBodySchema } from "@/lib/integrations/git/schemas";
import {
  jsonError,
  parseZodError,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import {
  isWorkspaceMember,
  isProjectInWorkspace,
} from "@/lib/integrations/git/workspace";
import { toAccessResponse } from "@/lib/rbac/http";
import { query, SCHEMA } from "@/lib/db";
import type { GitRepo } from "@/types/git";

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
});

async function loadProjectRepos(
  workspaceId: string,
  projectId: string,
  lazyCreate: boolean,
): Promise<GitRepo[]> {
  if (!isOneworkVcConfigured()) {
    return [];
  }

  let repo = await getPlatformRepoForProject(projectId);
  if (!repo && lazyCreate) {
    const project = await query<{ key: string; name: string }>(
      `SELECT key, name FROM ${SCHEMA}.projects WHERE id = $1`,
      [projectId],
    );
    const row = project.rows[0];
    if (row) {
      await ensureOneworkProjectRepo({
        workspaceId,
        projectId,
        projectKey: row.key,
        projectName: row.name,
      });
      repo = await getPlatformRepoForProject(projectId);
    }
  }

  return repo ? [repo] : [];
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    if (!isOneworkVcConfigured()) {
      return NextResponse.json([]);
    }

    const { searchParams } = new URL(request.url);
    const q = querySchema.parse(Object.fromEntries(searchParams.entries()));

    const member = await isWorkspaceMember(q.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const projectOk = await isProjectInWorkspace(q.projectId, q.workspaceId);
    if (!projectOk)
      return jsonError(404, "Project not found in this workspace");

    const repos = await loadProjectRepos(q.workspaceId, q.projectId, true);
    return NextResponse.json(repos);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return jsonError(
      500,
      e instanceof Error ? e.message : "Failed to load platform repositories",
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    if (!isOneworkVcConfigured()) {
      return jsonError(503, "OneWork Version Control is not configured");
    }

    const body = await request.json();
    const data = oneworkProjectRepoBodySchema.parse(body);

    const member = await isWorkspaceMember(data.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const projectOk = await isProjectInWorkspace(
      data.projectId,
      data.workspaceId,
    );
    if (!projectOk)
      return jsonError(404, "Project not found in this workspace");

    await assertProjectWritable(data.projectId);

    const existing = await getPlatformRepoForProject(data.projectId);
    if (existing) {
      return NextResponse.json([existing]);
    }

    const project = await query<{ key: string; name: string }>(
      `SELECT key, name FROM ${SCHEMA}.projects WHERE id = $1`,
      [data.projectId],
    );
    const row = project.rows[0];
    if (!row) return jsonError(404, "Project not found");

    const result = await ensureOneworkProjectRepo({
      workspaceId: data.workspaceId,
      projectId: data.projectId,
      projectKey: row.key,
      projectName: row.name,
    });

    if (!result.ok) {
      return jsonError(
        502,
        result.error === "not_configured"
          ? "OneWork Version Control is not configured"
          : result.error || "Failed to create repository",
      );
    }

    const repo = await getPlatformRepoForProject(data.projectId);
    if (!repo) {
      return jsonError(502, "Repository was created but could not be loaded");
    }

    return NextResponse.json([repo]);
  } catch (e: unknown) {
    const access = toAccessResponse(e);
    if (access) {
      const body = await access.json();
      return NextResponse.json(body, { status: access.status });
    }
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return jsonError(
      500,
      e instanceof Error ? e.message : "Failed to create platform repository",
    );
  }
}
