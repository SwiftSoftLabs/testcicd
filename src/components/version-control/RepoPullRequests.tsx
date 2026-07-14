"use client";

import React, { useMemo, useState } from "react";

import PullRequestDetailView, {
  type PullRequestDetailViewProps,
} from "@/components/version-control/PullRequestDetailView";
import PresenceDot from "@/components/PresenceDot";
import { useAppContext } from "@/context/AppContext";
import { presenceFromMemberStatus } from "@/lib/presence";
import { pullRequestHasMergeConflicts } from "@/lib/integrations/git/pr-merge";
import { prLabel } from "@/lib/integrations/git/vc-pr-ui";
import type { GitProvider } from "@/types/git";
import type { PullRequest } from "@/types";

type PRDetailTab = PullRequestDetailViewProps["prDetailTab"];

type RepoPullRequestsProps = {
  pullRequests: PullRequest[];
  loading: boolean;
  prFilter: "open" | "closed";
  onPrFilter: (f: "open" | "closed") => void;
  selectedPR: PullRequest | null;
  onSelectPR: (pr: PullRequest) => void;
  onBack: () => void;
  prDetailTab: PRDetailTab;
  onPrDetailTab: (t: PRDetailTab) => void;
  loadingDetail: boolean;
  workspaceId: string;
  projectId: string;
  projectName?: string | null;
  gitProvider: GitProvider;
  owner: string;
  repo: string;
  onRefreshSelectedPR: () => Promise<void>;
  onRefreshPullList?: () => Promise<void>;
  onPatchSelectedPR?: (patch: Partial<PullRequest>) => void;
  readOnly?: boolean;
};

export default function RepoPullRequests({
  pullRequests,
  loading,
  prFilter,
  onPrFilter,
  selectedPR,
  onSelectPR,
  onBack,
  prDetailTab,
  onPrDetailTab,
  loadingDetail,
  workspaceId,
  projectId,
  projectName,
  gitProvider,
  owner,
  repo,
  onRefreshSelectedPR,
  onRefreshPullList,
  onPatchSelectedPR,
  readOnly = false,
}: RepoPullRequestsProps) {
  const { users } = useAppContext();
  const [authorFilter, setAuthorFilter] = useState("");
  const [draftOnly, setDraftOnly] = useState(false);
  const [conflictsOnly, setConflictsOnly] = useState(false);

  const filtered = useMemo(() => {
    const base = pullRequests.filter((pr) =>
      prFilter === "open" ? pr.is_open : !pr.is_open,
    );
    const authorQ = authorFilter.trim().toLowerCase();
    return base.filter((pr) => {
      if (draftOnly && !pr.is_draft) return false;
      if (conflictsOnly && !pullRequestHasMergeConflicts(pr)) return false;
      if (!authorQ) return true;
      const author =
        pr.author?.full_name?.toLowerCase() ??
        pr.author_id?.toLowerCase() ??
        "";
      return author.includes(authorQ);
    });
  }, [pullRequests, prFilter, authorFilter, draftOnly, conflictsOnly]);

  const openCount = pullRequests.filter((p) => p.is_open).length;
  const closedCount = pullRequests.filter((p) => !p.is_open).length;

  const getPresence = (authorId: string | undefined) => {
    if (!authorId) return null;
    const member = users.find((u) => u.id === authorId);
    return member ? presenceFromMemberStatus(member.status) : null;
  };

  const renderAuthorPresence = (authorId?: string | null) => {
    const presence = getPresence(authorId ?? undefined);
    if (!presence) return null;
    return (
      <span className="absolute -bottom-0.5 -right-0.5">
        <PresenceDot status={presence} />
      </span>
    );
  };

  if (selectedPR) {
    return (
      <PullRequestDetailView
        pr={selectedPR}
        prDetailTab={prDetailTab}
        onPrDetailTab={onPrDetailTab}
        loadingDetail={loadingDetail}
        workspaceId={workspaceId}
        projectId={projectId}
        projectName={projectName}
        gitProvider={gitProvider}
        owner={owner}
        repo={repo}
        onBack={onBack}
        onRefreshSelectedPR={onRefreshSelectedPR}
        onRefreshPullList={onRefreshPullList}
        onPatchSelectedPR={onPatchSelectedPR}
        readOnly={readOnly}
        variant="embedded"
      />
    );
  }

  return (
    <div className="w-full animate-in fade-in duration-300">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
          <h3 className="text-lg font-bold text-main">Pull request history</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
              placeholder="Filter by author"
              className="h-8 px-3 rounded-lg bg-background-dark border border-border-dark text-xs text-main min-w-[140px]"
            />
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-text-secondary">
              <input
                type="checkbox"
                checked={draftOnly}
                onChange={(e) => setDraftOnly(e.target.checked)}
              />
              Draft
            </label>
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-text-secondary">
              <input
                type="checkbox"
                checked={conflictsOnly}
                onChange={(e) => setConflictsOnly(e.target.checked)}
              />
              Conflicts
            </label>
            <div className="flex gap-2 p-1 bg-surface-dark rounded-lg border border-border-dark">
            <button
              type="button"
              onClick={() => onPrFilter("open")}
              className={`cursor-pointer px-3 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                prFilter === "open"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-main"
              }`}
            >
              Open ({openCount})
            </button>
            <button
              type="button"
              onClick={() => onPrFilter("closed")}
              className={`cursor-pointer px-3 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                prFilter === "closed"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-main"
              }`}
            >
              Closed ({closedCount})
            </button>
          </div>
          </div>
        </div>
        {loading && (
          <p className="text-text-secondary text-sm italic">
            Loading pull requests…
          </p>
        )}
        {!loading &&
          filtered.map((pr) => (
            <div
              key={pr.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectPR(pr)}
              onKeyDown={(e) => e.key === "Enter" && onSelectPR(pr)}
              className="bg-surface-dark border border-border-dark rounded-xl p-4 flex gap-4 hover:border-primary/50 transition-all cursor-pointer group"
            >
              <div className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    pr.author?.avatar_url ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(pr.author?.full_name || "?")}&background=random`
                  }
                  className="size-10 rounded-full border border-border-dark"
                  alt=""
                />
                {renderAuthorPresence(pr.author_id)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`material-symbols-outlined text-lg shrink-0 ${pr.is_open ? "text-emerald-400" : "text-purple-400"}`}
                    >
                      {pr.is_open ? "radio_button_checked" : "check_circle"}
                    </span>
                    <h4 className="text-sm font-bold text-main group-hover:text-primary transition-colors truncate">
                      {pr.title}
                    </h4>
                    {pr.is_draft ? (
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border border-slate-500/40 text-slate-300 shrink-0">
                        Draft
                      </span>
                    ) : null}
                    {pullRequestHasMergeConflicts(pr) ? (
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-400 shrink-0">
                        Conflicts
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[10px] text-text-secondary font-mono bg-background-dark px-1.5 py-0.5 rounded border border-border-dark shrink-0">
                    {prLabel(pr)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1 ml-8 text-xs text-text-secondary">
                  <span>{pr.author?.full_name || "Unknown"}</span>
                  <span className="size-1 rounded-full bg-text-secondary/30" />
                  <span>{new Date(pr.created_at).toLocaleDateString()}</span>
                  <span className="size-1 rounded-full bg-text-secondary/30" />
                  <span className="font-mono text-[10px]">
                    {pr.compare_branch} → {pr.base_branch}
                  </span>
                  {typeof pr.commits_count === "number" && pr.commits_count > 0 ? (
                    <>
                      <span className="size-1 rounded-full bg-text-secondary/30" />
                      <span>{pr.commits_count} commits</span>
                    </>
                  ) : null}
                </div>
                {pr.labels.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-2 ml-8">
                    {pr.labels.slice(0, 6).map((l) => (
                      <span
                        key={l}
                        className="px-1.5 py-0.5 bg-white/5 border border-border-dark text-[9px] font-bold text-text-secondary rounded"
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        {!loading && filtered.length === 0 && (
          <div className="py-16 text-center text-text-secondary italic text-sm">
            No {prFilter} pull requests.
          </div>
        )}
      </div>
    </div>
  );
}
