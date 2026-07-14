"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import DiffFilesView from "@/components/version-control/DiffFilesView";
import VcBrandedHeader from "@/components/version-control/VcBrandedHeader";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import { api } from "@/lib/api";
import { buildVersionControlProjectUrl } from "@/lib/integrations/git/vc-share-url";
import type { GitCommitDetail, GitProvider, GitRepo } from "@/types/git";

function splitRepoPath(fullName: string): { owner: string; repo: string } {
  const i = fullName.indexOf("/");
  if (i < 0) return { owner: fullName, repo: "" };
  return { owner: fullName.slice(0, i), repo: fullName.slice(i + 1) };
}

function CommitDetailPageInner() {
  const params = useParams<{ sha: string }>();
  const searchParams = useSearchParams();
  const { addToast } = useUIContext();
  const { projects, selectedWorkspaceId } = useAppContext();

  const sha = decodeURIComponent(params.sha);
  const projectId = searchParams.get("projectId");
  const workspaceIdParam = searchParams.get("workspaceId");
  const providerParam = searchParams.get("provider") as GitProvider | null;

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );
  const workspaceId = workspaceIdParam ?? selectedWorkspaceId ?? "";
  const projectName = project?.name ?? null;

  const [gitRepo, setGitRepo] = useState<GitRepo | null>(null);
  const [commit, setCommit] = useState<GitCommitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCommit = useCallback(async () => {
    if (!projectId || !sha) {
      setError("Invalid commit link.");
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
        setCommit(null);
        return;
      }
      setGitRepo(linked);
      const { owner, repo } = splitRepoPath(linked.fullName);
      const detail = await api.integrations.git.commitDetail(
        linked.provider,
        workspaceId,
        owner,
        repo,
        sha,
      );
      setCommit(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load commit");
      setCommit(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, providerParam, sha, workspaceId]);

  useEffect(() => {
    void loadCommit();
  }, [loadCommit]);

  const copySha = async () => {
    try {
      await navigator.clipboard.writeText(sha);
      addToast("Commit SHA copied.", "success");
    } catch {
      addToast("Could not copy SHA.", "warning");
    }
  };

  if (!projectId || !sha) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8 text-center">
        <p className="text-text-secondary text-sm">This commit link is invalid.</p>
        <Link href="/version-control" className="text-primary font-bold text-sm hover:underline">
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

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      {gitRepo ? (
        <VcBrandedHeader
          provider={gitRepo.provider}
          projectName={projectName}
          projectId={projectId}
        />
      ) : null}

      {loading ? (
        <div className="p-12 text-center text-text-secondary text-sm">
          Loading commit…
        </div>
      ) : commit ? (
        <div className="w-full max-w-[1600px] mx-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border border-border-dark rounded-xl bg-surface-dark/80 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-mono text-text-secondary truncate">{sha}</p>
              <h1 className="text-lg font-bold text-main mt-1">{commit.message}</h1>
              <p className="text-xs text-text-secondary mt-1">
                {commit.author?.full_name || "Unknown"} ·{" "}
                {new Date(commit.created_at).toLocaleString()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void copySha()}
              className="cursor-pointer h-9 px-3 rounded-lg border border-border-dark text-xs font-bold text-main hover:bg-white/5"
            >
              Copy SHA
            </button>
          </div>
          <DiffFilesView
            diffFiles={commit.diffFiles ?? []}
            readOnly
            fileAnchorPrefix="commit-diff"
            emptyMessage="No file changes in this commit."
          />
        </div>
      ) : (
        <div className="p-12 text-center text-text-secondary text-sm">
          Commit not found.
        </div>
      )}
    </div>
  );
}

export default function CommitDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-text-secondary text-sm">
          Loading commit…
        </div>
      }
    >
      <CommitDetailPageInner />
    </Suspense>
  );
}
