import { NextResponse } from "next/server";
import { z } from "zod";

import {
  oneworkCreateRelease,
  oneworkListReleases,
} from "@/lib/integrations/git/onework";
import {
  findIntegration,
  getAccessTokenForIntegration,
} from "@/lib/integrations/git/repository";
import {
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

const createReleaseBodySchema = z.object({
  workspaceId: z.string().uuid(),
  tagName: z.string().min(1).max(255),
  target: z.string().min(1).max(255),
  name: z.string().max(255).optional().default(""),
  body: z.string().max(100_000).optional().default(""),
  draft: z.boolean().optional().default(false),
  prerelease: z.boolean().optional().default(false),
});

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
    if (provider !== "onework") {
      return jsonError(
        400,
        "Releases via this route are only for OneWork Version Control",
      );
    }
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

    const row = await findIntegration(q.workspaceId, user.id, provider);
    if (!row) return jsonError(400, "OneWork Version Control is not ready yet");
    const token = await getAccessTokenForIntegration(row);
    const releases = await oneworkListReleases(token, owner, repo);
    return NextResponse.json(releases);
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
    if (provider !== "onework") {
      return jsonError(
        400,
        "Creating releases via this route is only for OneWork Version Control",
      );
    }
    const owner = decodeURIComponent(o);
    const repo = decodeURIComponent(rname);
    ownerRepoParamsSchema.parse({ owner, repo });

    const body = createReleaseBodySchema.parse(await request.json());

    const member = await isWorkspaceMember(body.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const row = await findIntegration(body.workspaceId, user.id, provider);
    if (!row) return jsonError(400, "OneWork Version Control is not ready yet");
    const token = await getAccessTokenForIntegration(row);
    const release = await oneworkCreateRelease(token, owner, repo, {
      tagName: body.tagName.trim(),
      target: body.target.trim(),
      name: body.name.trim(),
      body: body.body,
      draft: body.draft,
      prerelease: body.prerelease,
    });
    void notifyWorkspaceVcEvent({
      workspaceId: body.workspaceId,
      actorUserId: user.id,
      type: "vc_release",
      title: `Release ${release.name}`,
      content: `${owner}/${repo} · ${release.tagName}`,
      extra: `release:${release.id}`,
    }).catch(() => {});
    return NextResponse.json(release);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}
