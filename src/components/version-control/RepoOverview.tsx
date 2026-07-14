"use client";

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  GitProvider,
  GitRepo,
  GitTreeEntry,
  GitFileTextResult,
} from "@/types/git";

import { getProviderLabel } from "@/lib/integrations/git/provider-meta";
import { RepoCloneUrlPanel } from "@/components/version-control/RepoClonePopover";

function fileUrlOnProvider(
  provider: GitProvider,
  repoHtmlUrl: string,
  ref: string,
  filePath: string,
  githubHtmlUrl?: string | null,
): string {
  if (provider === "github" && githubHtmlUrl) return githubHtmlUrl;
  const base = repoHtmlUrl.replace(/\/$/, "");
  const pathInUrl = filePath
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
  const refEnc = encodeURIComponent(ref);
  if (provider === "github") {
    return `${base}/blob/${refEnc}/${pathInUrl}`;
  }
  return `${base}/src/branch/${refEnc}/${pathInUrl}`;
}

type RepoOverviewProps = {
  repo: GitRepo | null;
  repoName: string;
  provider: GitProvider;
  branch: string;
  contents: GitTreeEntry[];
  contentsLoading: boolean;
  navigationPath: string[];
  onNavRoot: () => void;
  onBreadcrumb: (index: number) => void;
  onOpenEntry: (entry: GitTreeEntry) => void;
  readmeMarkdown: string | null;
  readmeLoading: boolean;
  previewFile: GitTreeEntry | null;
  previewData: GitFileTextResult | null;
  previewLoading: boolean;
  previewError: string | null;
  onClosePreview: () => void;
  oneworkSshHost?: string | null;
  oneworkSshPort?: string | null;
};

export default function RepoOverview({
  repo,
  repoName,
  provider,
  branch,
  contents,
  contentsLoading,
  navigationPath,
  onNavRoot,
  onBreadcrumb,
  onOpenEntry,
  readmeMarkdown,
  readmeLoading,
  previewFile,
  previewData,
  previewLoading,
  previewError,
  onClosePreview,
  oneworkSshHost,
  oneworkSshPort,
}: RepoOverviewProps) {
  const openOnProviderLabel = `Open in ${getProviderLabel(provider)}`;

  const previewUrl = useMemo(() => {
    if (!previewFile || previewFile.type !== "file" || !repo?.htmlUrl)
      return null;
    return fileUrlOnProvider(
      provider,
      repo.htmlUrl,
      branch,
      previewFile.path,
      previewData?.htmlUrl,
    );
  }, [previewFile, repo?.htmlUrl, provider, branch, previewData?.htmlUrl]);

  const isMarkdownPreview = Boolean(
    previewFile?.name && /\.(md|mdx)$/i.test(previewFile.name),
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="lg:col-span-8 flex flex-col gap-6">
        <div className="bg-surface-dark border border-border-dark rounded-xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-white/[0.02] border-b border-border-dark flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onNavRoot}
              className="cursor-pointer text-primary hover:underline text-xs font-bold truncate max-w-[160px]"
            >
              {repoName}
            </button>
            {navigationPath.map((seg, i) => (
              <React.Fragment key={`${seg}-${i}`}>
                <span className="text-text-secondary text-xs">/</span>
                <button
                  type="button"
                  onClick={() => onBreadcrumb(i)}
                  className="cursor-pointer text-primary hover:underline text-xs font-bold"
                >
                  {seg}
                </button>
              </React.Fragment>
            ))}
          </div>

          <div className="flex flex-col">
            {contentsLoading && (
              <div className="p-8 text-center text-text-secondary italic text-sm">
                Loading tree…
              </div>
            )}
            {!contentsLoading &&
              contents.map((item) => {
                const isSelected =
                  previewFile?.path === item.path && item.type === "file";
                return (
                  <div
                    key={item.path}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenEntry(item)}
                    onKeyDown={(e) => e.key === "Enter" && onOpenEntry(item)}
                    className={`flex items-center justify-between px-4 py-3.5 hover:bg-white/5 transition-all border-b border-border-dark/30 last:border-0 group cursor-pointer ${
                      isSelected
                        ? "bg-primary/10 ring-inset ring-1 ring-primary/30"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`material-symbols-outlined text-[20px] ${item.type === "folder" ? "text-blue-400 fill-1" : "text-slate-400"}`}
                      >
                        {item.type === "folder" ? "folder" : "description"}
                      </span>
                      <span className="text-main text-sm font-medium group-hover:text-primary transition-colors">
                        {item.name}
                      </span>
                    </div>
                    <span className="flex-1 px-8 text-text-secondary text-xs truncate hidden sm:block">
                      {item.lastCommitMessage ?? "—"}
                    </span>
                    <span className="text-text-secondary text-[10px] font-bold uppercase shrink-0">
                      {item.lastCommitTime ?? ""}
                    </span>
                  </div>
                );
              })}
            {!contentsLoading && contents.length === 0 && (
              <div className="p-8 text-center text-text-secondary italic text-sm">
                Empty directory
              </div>
            )}
          </div>
        </div>

        {previewFile && previewFile.type === "file" && (
          <div className="bg-surface-dark border border-border-dark rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 bg-white/[0.02] border-b border-border-dark flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-text-secondary text-[20px] shrink-0">
                  draft
                </span>
                <span className="text-main text-sm font-bold truncate">
                  {previewFile.name}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="px-3 py-1.5 rounded-lg bg-white/10 text-xs font-black uppercase tracking-widest text-main hover:bg-white/15 transition-colors"
                  >
                    {openOnProviderLabel}
                  </a>
                )}
                <button
                  type="button"
                  onClick={onClosePreview}
                  className="cursor-pointer size-9 rounded-lg border border-border-dark flex items-center justify-center text-text-secondary hover:text-main hover:bg-white/5 transition-colors"
                  title="Close preview"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    close
                  </span>
                </button>
              </div>
            </div>
            <div className="p-4 max-h-[min(70vh,520px)] overflow-auto">
              {previewLoading && (
                <div className="py-12 text-center text-text-secondary text-sm italic">
                  Loading file…
                </div>
              )}
              {!previewLoading && previewError && (
                <p className="text-red-400 text-sm">{previewError}</p>
              )}
              {!previewLoading && !previewError && previewData?.isBinary && (
                <p className="text-text-secondary text-sm leading-relaxed">
                  This file is binary or too large to preview here.{" "}
                  {previewUrl ? (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary font-semibold hover:underline"
                    >
                      {openOnProviderLabel}
                    </a>
                  ) : null}
                </p>
              )}
              {!previewLoading &&
                !previewError &&
                previewData &&
                !previewData.isBinary &&
                previewData.text != null &&
                isMarkdownPreview && (
                  <div className="prose prose-invert max-w-none prose-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {previewData.text}
                    </ReactMarkdown>
                  </div>
                )}
              {!previewLoading &&
                !previewError &&
                previewData &&
                !previewData.isBinary &&
                previewData.text != null &&
                !isMarkdownPreview && (
                  <pre className="text-xs font-mono text-main whitespace-pre-wrap break-words leading-relaxed bg-background-dark rounded-lg p-4 border border-border-dark">
                    {previewData.text}
                  </pre>
                )}
            </div>
          </div>
        )}

        <div className="bg-surface-dark border border-border-dark rounded-xl p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border-dark">
            <span className="material-symbols-outlined text-text-secondary">
              menu_book
            </span>
            <h3 className="text-main font-bold">README</h3>
          </div>
          {readmeLoading && (
            <p className="text-text-secondary text-sm italic">
              Loading README…
            </p>
          )}
          {!readmeLoading && !readmeMarkdown && (
            <p className="text-text-secondary text-sm italic">
              No README found for this branch.
            </p>
          )}
          {!readmeLoading && readmeMarkdown && (
            <div className="prose prose-invert max-w-none prose-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {readmeMarkdown}
              </ReactMarkdown>
            </div>
          )}
          {repo?.cloneUrl?.trim() && (
            <div className="mt-8">
              <h2 className="text-lg font-bold text-main mb-4">Quick clone</h2>
              <div className="rounded-xl border border-border-dark bg-background-dark/40 p-4">
                <RepoCloneUrlPanel
                  repo={repo}
                  oneworkSshHost={oneworkSshHost}
                  oneworkSshPort={oneworkSshPort}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-4 flex flex-col gap-6">
        <div className="bg-surface-dark border border-border-dark rounded-xl p-5 shadow-sm">
          <h3 className="text-main font-bold text-sm mb-4 uppercase tracking-widest text-opacity-50">
            About
          </h3>
          <p className="text-text-secondary text-sm mb-6 leading-relaxed">
            {repo?.description || "No description provided."}
          </p>
          <div className="space-y-4">
            {repo?.homepage ? (
              <div
                role="button"
                tabIndex={0}
                className="flex items-center gap-3 text-text-secondary text-sm group cursor-pointer hover:text-main transition-all"
                onClick={() => window.open(repo.homepage ?? "", "_blank")}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  window.open(repo.homepage ?? "", "_blank")
                }
              >
                <span className="material-symbols-outlined text-[18px]">
                  link
                </span>
                <span className="text-primary group-hover:underline truncate">
                  {repo.homepage}
                </span>
              </div>
            ) : null}
            <div className="flex items-center gap-3 text-text-secondary text-sm">
              <span className="material-symbols-outlined text-[18px]">
                scale
              </span>
              <span>{repo?.license ?? "—"}</span>
            </div>
            <div className="flex items-center gap-3 text-text-secondary text-sm">
              <span className="material-symbols-outlined text-[18px]">
                star
              </span>
              <span>{repo?.stargazersCount ?? 0} Stars</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
