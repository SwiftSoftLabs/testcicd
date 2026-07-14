import { NextResponse } from "next/server";

import { getGitClientForUser } from "@/lib/integrations/git/client-factory";
import {
  addRepoCollaboratorBodySchema,
  ownerRepoParamsSchema,
  workspaceIdQuerySchema,
} from "@/lib/integrations/git/schemas";
import {
  jsonError,
  mapUpstreamError,
  parseProviderParam,
  parseZodError,
  rateLimitGit,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";
import { notifyWorkspaceVcEvent } from "@/lib/integrations/git/vc-notifications";
import {
  clearRepoCollaboratorExclusion,
  recordRepoCollaboratorExclusion,
} from "@/lib/integrations/git/collaborator-exclusions";
import { z } from "zod";

export async function GET(
  request: Request,
  context: {
    params: Promise<{ provider: string; owner: string; repo: string }>;
  },
) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const { provider: p, owner: o, repo: rname } = await context.params;
    const provider = parseProviderParam(p);
    const owner = decodeURIComponent(o);
    const repo = decodeURIComponent(rname);
    ownerRepoParamsSchema.parse({ owner, repo });

    const { searchParams } = new URL(request.url);
    const q = workspaceIdQuerySchema.parse(
      Object.fromEntries(searchParams.entries()),
    );

    const member = await isWorkspaceMember(q.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(q.workspaceId, user.id, provider);
    const data = await client.listRepositoryCollaborators(owner, repo);
    return NextResponse.json(data);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ provider: string; owner: string; repo: string }>;
  },
) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const { provider: p, owner: o, repo: rname } = await context.params;
    const provider = parseProviderParam(p);
    const owner = decodeURIComponent(o);
    const repo = decodeURIComponent(rname);
    ownerRepoParamsSchema.parse({ owner, repo });

    const body = addRepoCollaboratorBodySchema.parse(await request.json());

    const member = await isWorkspaceMember(body.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(
      body.workspaceId,
      user.id,
      provider,
    );
    const result = await client.addRepositoryCollaborator(owner, repo, {
      username: body.username,
      permission: body.permission,
    });
    if (provider === "onework") {
      await clearRepoCollaboratorExclusion({
        workspaceId: body.workspaceId,
        owner,
        repo,
        giteaUsername: body.username,
      }).catch(() => {});
    }
    void notifyWorkspaceVcEvent({
      workspaceId: body.workspaceId,
      actorUserId: user.id,
      type: "vc_collaborator",
      title: `Collaborator invited on ${owner}/${repo}`,
      content: result.message,
      extra: `collaborator:${body.username.trim().toLowerCase()}`,
    }).catch(() => {});
    return NextResponse.json(result);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}

const deleteCollaboratorSchema = z.object({
  workspaceId: z.string().uuid(),
  username: z.string().min(1).max(100),
});

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ provider: string; owner: string; repo: string }>;
  },
) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const { provider: p, owner: o, repo: rname } = await context.params;
    const provider = parseProviderParam(p);
    const owner = decodeURIComponent(o);
    const repo = decodeURIComponent(rname);
    ownerRepoParamsSchema.parse({ owner, repo });

    const { searchParams } = new URL(request.url);
    const body = deleteCollaboratorSchema.parse({
      workspaceId: searchParams.get("workspaceId"),
      username: searchParams.get("username"),
    });

    const member = await isWorkspaceMember(body.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(
      body.workspaceId,
      user.id,
      provider,
    );
    if (!client.removeRepositoryCollaborator) {
      return jsonError(400, "Removing collaborators is not supported for this provider");
    }
    await client.removeRepositoryCollaborator(owner, repo, body.username);
    if (provider === "onework") {
      await recordRepoCollaboratorExclusion({
        workspaceId: body.workspaceId,
        owner,
        repo,
        giteaUsername: body.username,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}
