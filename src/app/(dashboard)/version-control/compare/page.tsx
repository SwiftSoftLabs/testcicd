"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import DiffFilesView from "@/components/version-control/DiffFilesView";
import { useAppContext } from "@/context/AppContext";
import { api } from "@/lib/api";
import { buildVersionControlProjectUrl } from "@/lib/integrations/git/vc-share-url";
import type { DiffFile } from "@/types";
import type { GitProvider, GitRepo } from "@/types/git";

function splitRepoPath(fullName: string): { owner: string; repo: string } {
  const i = fullName.indexOf("/");
  if (i < 0) return { owner: fullName, repo: "" };
  return { owner: fullName.slice(0, i), repo: fullName.slice(i + 1) };
}

function ComparePageInner() {
  const searchParams = useSearchParams();
  const { projects, selectedWorkspaceId } = useAppContext();

  const projectId = searchParams.get("projectId");
  const base = searchParams.get("base") ?? "main";
  const head = searchParams.get("head") ?? "";
  const workspaceIdParam = searchParams.get("workspaceId");

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );
  const workspaceId = workspaceIdParam ?? selectedWorkspaceId ?? "";

  const [gitRepo, setGitRepo] = useState<GitRepo | null>(null);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !workspaceId || !head) {
      setError("Compare link requires projectId, base, and head.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const providers: GitProvider[] = ["onework", "github", "gitlab"];
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
          setError("No repository linked to this project.");
          return;
        }
        if (!cancelled) setGitRepo(linked);

        const { owner, repo } = splitRepoPath(linked.fullName);
        const hint = await api.integrations.git.pullCreateHint(
          linked.provider,
          workspaceId,
          owner,
          repo,
          base,
          head,
        );
        if (!hint.show) {
          setDiffFiles([]);
          setError("No changes to compare between these branches.");
          return;
        }

        const commits = await api.integrations.git.commits(
          linked.provider,
          workspaceId,
          owner,
          repo,
          head,
          1,
        );
        const tip = commits[0];
        if (!tip) {
          setDiffFiles([]);
          return;
        }
        const detail = await api.integrations.git.commitDetail(
          linked.provider,
          workspaceId,
          owner,
          repo,
          tip.id,
        );
        if (!cancelled) setDiffFiles(detail.diffFiles ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load compare view");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [base, head, projectId, workspaceId]);

  if (!projectId) {
    return (
      <div className="p-8 text-center text-text-secondary text-sm">
        Missing project for compare view.
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-main">Compare branches</h1>
          <p className="text-sm text-text-secondary mt-1 font-mono">
            {head} → {base}
          </p>
        </div>
        <Link
          href={buildVersionControlProjectUrl(projectId)}
          className="text-primary text-sm font-bold hover:underline"
        >
          Back to project
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-text-secondary italic">Loading compare…</p>
      ) : error ? (
        <p className="text-sm text-amber-400">{error}</p>
      ) : (
        <DiffFilesView
          diffFiles={diffFiles}
          readOnly
          fileAnchorPrefix="compare-diff"
          emptyMessage="No diff available for this comparison."
        />
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-text-secondary text-sm">
          Loading compare…
        </div>
      }
    >
      <ComparePageInner />
    </Suspense>
  );
}
