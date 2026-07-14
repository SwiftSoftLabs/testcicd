import { NextResponse } from "next/server";

import { getGitClientForUser } from "@/lib/integrations/git/client-factory";
import {
  ownerRepoParamsSchema,
  pullsQuerySchema,
  createPullRequestBodySchema,
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
import { parseVcPullId } from "@/lib/integrations/git/vc-pull-id";
import { fetchPullRequestTemplates } from "@/lib/integrations/git/pr-templates";
import {
  CODEOWNERS_PATHS,
  ownersForChangedFiles,
  parseCodeowners,
} from "@/lib/integrations/git/codeowners";
import {
  enrichPullWithAuthorUserId,
  enrichPullsWithAuthorUserId,
  recordOneworkPullCreator,
} from "@/lib/integrations/git/vc-author";

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
    const q = pullsQuerySchema.parse(
      Object.fromEntries(searchParams.entries()),
    );

    const member = await isWorkspaceMember(q.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(q.workspaceId, user.id, provider);
    const pulls = await client.listPullRequests(owner, repo, {
      state: q.state,
      page: q.page,
    });
    const enriched = await enrichPullsWithAuthorUserId(pulls, provider, {
      workspaceId: q.workspaceId,
      repoOwner: owner,
      repoName: repo,
    });
    if (q.templates) {
      const branches = await client.listBranches(owner, repo);
      const defaultBranch =
        branches.find((b) => b.isDefault)?.name ?? branches[0]?.name;
      const templates = await fetchPullRequestTemplates(
        client,
        owner,
        repo,
        defaultBranch,
      );
      return NextResponse.json({ pulls: enriched, templates });
    }
    return NextResponse.json(enriched);
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

    const body = createPullRequestBodySchema.parse(await request.json());

    const member = await isWorkspaceMember(body.workspaceId, user.id);
    if (!member) return jsonError(404, "Workspace not found or access denied");

    const limited = await rateLimitGit(user.id, provider);
    if (limited) return limited;

    const client = await getGitClientForUser(
      body.workspaceId,
      user.id,
      provider,
    );
    const created = await client.createPullRequest(owner, repo, {
      title: body.title,
      body: body.description,
      base: body.base,
      head: body.head,
      draft: body.draft,
    });
    const parsed = parseVcPullId(created.id);
    if (provider === "onework" && parsed?.number) {
      await recordOneworkPullCreator({
        workspaceId: body.workspaceId,
        repoOwner: owner,
        repoName: repo,
        prNumber: parsed.number,
        userId: user.id,
      });
    }
    const pullRequest = await enrichPullWithAuthorUserId(
      provider === "onework"
        ? { ...created, author_user_id: user.id }
        : created,
      provider,
      {
        workspaceId: body.workspaceId,
        repoOwner: owner,
        repoName: repo,
      },
    );
    void notifyWorkspaceVcEvent({
      workspaceId: body.workspaceId,
      actorUserId: user.id,
      type: "vc_pr_opened",
      title: `PR opened: ${created.title}`,
      content: `${owner}/${repo} #${parsed?.number ?? "?"} — ${created.title}`,
      projectId: body.projectId ?? null,
      extra: `pr=${parsed?.number ?? created.id}:opened`,
    }).catch(() => {});

    if (parsed?.number && client.requestPullRequestReviewers) {
      void (async () => {
        try {
          const { pull, diffFiles } = await client.getPullRequestDetail(
            owner,
            repo,
            parsed.number,
          );
          const filenames = (pull.diffFiles ?? diffFiles ?? []).map(
            (f) => f.filename,
          );
          if (filenames.length === 0) return;
          for (const path of CODEOWNERS_PATHS) {
            const file = await client.getFileText(owner, repo, path);
            if (!file?.text) continue;
            const owners = ownersForChangedFiles(
              parseCodeowners(file.text),
              filenames,
            );
            if (owners.length > 0) {
              await client.requestPullRequestReviewers!(
                owner,
                repo,
                parsed.number,
                owners.slice(0, 10),
              );
            }
            break;
          }
        } catch {
          /* CODEOWNERS auto-request is best-effort */
        }
      })();
    }

    return NextResponse.json(pullRequest);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "issues" in e)
      return jsonError(400, parseZodError(e));
    return mapUpstreamError(e);
  }
}
