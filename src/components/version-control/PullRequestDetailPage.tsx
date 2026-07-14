"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import PullRequestDetailView from "@/components/version-control/PullRequestDetailView";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import { api } from "@/lib/api";
import { buildVersionControlProjectUrl } from "@/lib/integrations/git/vc-share-url";
import type { GitProvider, GitRepo } from "@/types/git";
import type { PullRequest } from "@/types";

function splitRepoPath(fullName: string): { owner: string; repo: string } {
  const i = fullName.indexOf("/");
  if (i < 0) return { owner: fullName, repo: "" };
  return { owner: fullName.slice(0, i), repo: fullName.slice(i + 1) };
}

function PullRequestDetailPageInner() {
  const params = useParams<{ number: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { addToast } = useUIContext();
  const { projects, selectedWorkspaceId } = useAppContext();

  const pullNumber = Number(params.number);
  const projectId = searchParams.get("projectId");
  const workspaceIdParam = searchParams.get("workspaceId");
  const providerParam = searchParams.get("provider") as GitProvider | null;

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const workspaceId = workspaceIdParam ?? selectedWorkspaceId ?? "";
  const projectName = project?.name ?? null;
  const isLockedProject = project?.quota_locked === true;

  const [gitRepo, setGitRepo] = useState<GitRepo | null>(null);
  const [pr, setPr] = useState<PullRequest | null>(null);
  const [prDetailTab, setPrDetailTab] =
    useState<"conversation" | "files">("conversation");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { owner, repo } = useMemo(
    () => (gitRepo ? splitRepoPath(gitRepo.fullName) : { owner: "", repo: "" }),
    [gitRepo],
  );

  const gitProvider: GitProvider = gitRepo?.provider ?? "onework";

  const loadPr = useCallback(async () => {
    if (!projectId || !Number.isFinite(pullNumber) || pullNumber < 1) {
      setError("Invalid pull request link.");
      setLoading(false);
      return;
    }
    if (!workspaceId) {
      setError("Workspace not found for this project.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const providers: GitProvider[] = providerParam
        ? [providerParam]
        : ["onework", "github", "gitlab"];
      let linked: GitRepo | null = null;
      for (const p of providers) {
        const repos = await api.integrations.git.linkedRepos.list(
          workspaceId,
          projectId,
          p,
        );
        if (repos[0]) {
          linked = repos[0];
          break;
        }
      }
      if (!linked) {
        setError("No version control repository found for this project.");
        setGitRepo(null);
        setPr(null);
        return;
      }
      setGitRepo(linked);

      const { owner: o, repo: r } = splitRepoPath(linked.fullName);
      const { pullRequest, diffFiles } = await api.integrations.git.pullDetail(
        linked.provider,
        workspaceId,
        o,
        r,
        pullNumber,
      );
      setPr({ ...pullRequest, diffFiles });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load pull request",
      );
      setPr(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, providerParam, pullNumber, workspaceId]);

  useEffect(() => {
    void loadPr();
  }, [loadPr]);

  const refreshSelectedPR = useCallback(async () => {
    if (!workspaceId || !gitRepo || !Number.isFinite(pullNumber)) return;
    const { owner: o, repo: r } = splitRepoPath(gitRepo.fullName);
    try {
      const { pullRequest, diffFiles } = await api.integrations.git.pullDetail(
        gitRepo.provider,
        workspaceId,
        o,
        r,
        pullNumber,
      );
      setPr({ ...pullRequest, diffFiles });
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to refresh pull request",
        "error",
      );
    }
  }, [addToast, gitRepo, pullNumber, workspaceId]);

  const patchSelectedPR = useCallback((patch: Partial<PullRequest>) => {
    setPr((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  if (!projectId || !Number.isFinite(pullNumber)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8 text-center">
        <p className="text-text-secondary text-sm">
          This pull request link is missing a project.
        </p>
        <Link
          href="/version-control"
          className="text-primary font-bold text-sm hover:underline"
        >
          Back to Version Control
        </Link>
      </div>
    );
  }

  if (error && !loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8 text-center">
        <p className="text-text-secondary text-sm">{error}</p>
        <Link
          href={buildVersionControlProjectUrl(projectId)}
          className="text-primary font-bold text-sm hover:underline"
        >
          Back to project
        </Link>
      </div>
    );
  }

  if (!pr && !loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8 text-center">
        <p className="text-text-secondary text-sm">Pull request not found.</p>
        <Link
          href={buildVersionControlProjectUrl(projectId)}
          className="text-primary font-bold text-sm hover:underline"
        >
          Back to project
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      {pr ? (
        <PullRequestDetailView
          pr={pr}
          prDetailTab={prDetailTab}
          onPrDetailTab={setPrDetailTab}
          loadingDetail={loading}
          workspaceId={workspaceId}
          projectId={projectId}
          projectName={projectName}
          gitProvider={gitProvider}
          owner={owner}
          repo={repo}
          onBack={() =>
            router.push(buildVersionControlProjectUrl(projectId))
          }
          onRefreshSelectedPR={refreshSelectedPR}
          onPatchSelectedPR={patchSelectedPR}
          readOnly={isLockedProject}
          variant="page"
          backLabel="Version Control"
        />
      ) : (
        <div className="p-12 text-center text-text-secondary text-sm">
          Loading pull request…
        </div>
      )}
    </div>
  );
}

export default function PullRequestDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-text-secondary text-sm">
          Loading pull request…
        </div>
      }
    >
      <PullRequestDetailPageInner />
    </Suspense>
  );
}
