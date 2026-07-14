"use client";

import React, { useEffect, useMemo, useState } from "react";

import DiffFilesView from "@/components/version-control/DiffFilesView";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import type { GitCommitDetail, GitCommitListItem, GitProvider } from "@/types/git";

type RepoCommitsProps = {
  commits: GitCommitListItem[];
  loading: boolean;
  selectedDetail: GitCommitDetail | null;
  loadingDetail: boolean;
  onSelect: (sha: string) => void;
  onBack: () => void;
  gitProvider?: GitProvider;
};

function fileStatusIcon(status: string): string {
  const s = status.toLowerCase();
  if (s === "added") return "add_circle";
  if (s === "removed") return "remove_circle";
  if (s === "renamed") return "drive_file_rename_outline";
  return "edit_note";
}

export default function RepoCommits({
  commits,
  loading,
  selectedDetail,
  loadingDetail,
  onSelect,
  onBack,
  gitProvider,
}: RepoCommitsProps) {
  const { addToast } = useUIContext();
  const { appSettings } = useAppContext();
  const [fileFilter, setFileFilter] = useState("");

  useEffect(() => {
    setFileFilter("");
  }, [selectedDetail?.id]);

  const diffFiles = selectedDetail?.diffFiles ?? [];

  const sidebarEntries = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    return diffFiles
      .map((file, idx) => ({ file, idx }))
      .filter(({ file }) => !q || file.filename.toLowerCase().includes(q));
  }, [diffFiles, fileFilter]);

  const scrollToFile = (index: number) => {
    const el = document.getElementById(`commit-diff-${index}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const copySha = async (sha: string) => {
    try {
      await navigator.clipboard.writeText(sha);
      addToast("Commit SHA copied.", "success");
    } catch {
      addToast("Could not copy to clipboard.", "warning");
    }
  };

  return (
    <div className="w-full animate-in fade-in duration-300">
      {loadingDetail && (
        <div className="p-12 text-center text-text-secondary text-sm">
          Loading commit…
        </div>
      )}

      {!loadingDetail && selectedDetail ? (
        <div className="w-full max-w-[1600px] mx-auto space-y-4">
          {/* Top bar */}
          <div className="flex flex-wrap items-center gap-3 justify-between border border-border-dark rounded-xl bg-surface-dark/80 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={onBack}
                className="cursor-pointer flex items-center gap-2 text-text-secondary hover:text-main text-xs font-bold uppercase tracking-widest shrink-0"
              >
                <span className="material-symbols-outlined text-[18px]">
                  arrow_back
                </span>
                Commits
              </button>
              <span
                className="hidden sm:inline h-4 w-px bg-border-dark shrink-0"
                aria-hidden
              />
              <div className="flex items-center gap-2 min-w-0 font-mono text-xs text-text-secondary">
                <span
                  className="truncate max-w-[200px] sm:max-w-xs"
                  title={selectedDetail.id}
                >
                  {appSettings.developerMode
                    ? selectedDetail.id
                    : selectedDetail.id.substring(0, 7)}
                </span>
                <button
                  type="button"
                  onClick={() => void copySha(selectedDetail.id)}
                  className="cursor-pointer p-1 rounded-md text-text-secondary hover:text-main hover:bg-white/5 shrink-0"
                  title="Copy full SHA"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    content_copy
                  </span>
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-background-dark border border-border-dark text-main">
                {selectedDetail.files_changed} files
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                +{selectedDetail.insertions}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-red-500/10 border border-red-500/25 text-red-400">
                −{selectedDetail.deletions}
              </span>
              {selectedDetail.commitHtmlUrl && gitProvider !== "onework" ? (
                <a
                  href={selectedDetail.commitHtmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1 px-2 py-1 rounded-md border border-primary/30 hover:bg-primary/10"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    open_in_new
                  </span>
                  {gitProvider === "github"
                    ? "View on GitHub"
                    : gitProvider === "gitlab"
                      ? "View on GitLab"
                      : "View on provider"}
                </a>
              ) : null}
            </div>
          </div>

          {/* GitHub-like: file tree + main column */}
          <div className="flex flex-col xl:flex-row gap-6 items-start">
            {/* Sidebar — files (sticky on wide screens) */}
            <aside className="w-full xl:w-[280px] shrink-0 xl:sticky xl:top-2 xl:max-h-[calc(100vh-10rem)] flex flex-col gap-3 rounded-xl border border-border-dark bg-surface-dark/60 overflow-hidden">
              <div className="px-3 py-2.5 border-b border-border-dark bg-white/[0.03]">
                <p className="text-[10px] font-black text-text-secondary uppercase tracking-[0.15em] mb-2">
                  Files changed
                </p>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary text-[18px] pointer-events-none">
                    search
                  </span>
                  <input
                    type="search"
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    placeholder="Filter files…"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-background-dark border border-border-dark text-xs text-main placeholder:text-text-secondary/60 focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                  />
                </div>
              </div>
              <nav
                className="overflow-y-auto max-h-[40vh] xl:max-h-[calc(100vh-14rem)] px-2 pb-3 space-y-0.5"
                aria-label="Changed files"
              >
                {diffFiles.length === 0 ? (
                  <p className="text-xs text-text-secondary px-2 py-4 text-center italic">
                    No file list in API response.
                  </p>
                ) : sidebarEntries.length === 0 ? (
                  <p className="text-xs text-text-secondary px-2 py-4 text-center italic">
                    No files match filter.
                  </p>
                ) : (
                  sidebarEntries.map(({ file, idx }) => (
                    <button
                      key={`${file.filename}-${idx}`}
                      type="button"
                      onClick={() => scrollToFile(idx)}
                      className="cursor-pointer w-full text-left flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-white/5 border border-transparent hover:border-border-dark transition-colors group"
                    >
                      <span className="material-symbols-outlined text-[18px] text-text-secondary shrink-0 mt-0.5 group-hover:text-primary">
                        {fileStatusIcon(file.status)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-mono text-main leading-snug break-all">
                          {file.filename}
                        </span>
                        <span className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-text-secondary">
                            {file.status}
                          </span>
                          <span className="text-[9px] font-bold text-emerald-500">
                            +{file.additions}
                          </span>
                          <span className="text-[9px] font-bold text-red-400">
                            −{file.deletions}
                          </span>
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </nav>
            </aside>

            {/* Main — message + description + diffs */}
            <main className="flex-1 min-w-0 space-y-6 w-full">
              <div className="rounded-xl border border-border-dark bg-surface-dark/40 overflow-hidden">
                <div className="p-5 sm:p-6 border-b border-border-dark bg-white/[0.02]">
                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={
                        selectedDetail.author?.avatar_url ||
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedDetail.author?.full_name || "?")}&background=random`
                      }
                      className="size-12 rounded-xl border border-border-dark shrink-0"
                      alt=""
                    />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-xl sm:text-2xl font-bold text-main leading-tight">
                        {selectedDetail.message}
                      </h2>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm text-text-secondary">
                        <span className="font-semibold text-primary">
                          {selectedDetail.author?.full_name || "Unknown"}
                        </span>
                        <span className="text-text-secondary/50">·</span>
                        <time dateTime={selectedDetail.created_at}>
                          {new Date(selectedDetail.created_at).toLocaleString(
                            undefined,
                            {
                              dateStyle: "medium",
                              timeStyle: "short",
                            },
                          )}
                        </time>
                      </div>
                    </div>
                  </div>
                </div>
                {selectedDetail.description ? (
                  <div className="px-5 sm:px-6 py-4 border-b border-border-dark bg-background-dark/20">
                    <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] mb-2">
                      Description
                    </h3>
                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {selectedDetail.description}
                    </p>
                  </div>
                ) : null}
              </div>

              <div>
                <h3 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">
                    difference
                  </span>
                  Patch
                </h3>
                <DiffFilesView
                  diffFiles={diffFiles}
                  readOnly
                  fileAnchorPrefix="commit-diff"
                  emptyMessage="No line-by-line diff returned for this commit (binary or very large files are often omitted by the provider API)."
                />
              </div>
            </main>
          </div>
        </div>
      ) : !loadingDetail && !selectedDetail ? (
        <div className="max-w-3xl mx-auto space-y-4">
          <h3 className="text-lg font-bold text-main mb-6">Commit history</h3>
          {loading && (
            <p className="text-text-secondary text-sm italic">
              Loading commits…
            </p>
          )}
          {!loading &&
            commits.map((commit) => (
              <div
                key={commit.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(commit.id)}
                onKeyDown={(e) => e.key === "Enter" && onSelect(commit.id)}
                className="bg-surface-dark border border-border-dark rounded-xl p-4 flex gap-4 hover:border-primary/50 transition-all cursor-pointer group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    commit.author?.avatar_url ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(commit.author?.full_name || "?")}&background=random`
                  }
                  className="size-10 rounded-full border border-border-dark shrink-0"
                  alt=""
                />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline gap-2">
                    <h4 className="text-sm font-bold text-main group-hover:text-primary transition-colors truncate">
                      {commit.message}
                    </h4>
                    <span className="text-[10px] text-text-secondary font-mono bg-background-dark px-1.5 py-0.5 rounded border border-border-dark shrink-0">
                      {appSettings.developerMode
                        ? commit.id
                        : commit.id.substring(0, 7)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-text-secondary">
                      {commit.author?.full_name || "Unknown"}
                    </span>
                    <span className="size-1 rounded-full bg-text-secondary/30" />
                    <span className="text-xs text-text-secondary">
                      {new Date(commit.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          {!loading && commits.length === 0 && (
            <div className="py-16 text-center text-text-secondary italic text-sm">
              No commits loaded.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
