"use client";

import React, { useEffect, useMemo, useState } from "react";

import type { GitProvider, GitRepo } from "@/types/git";
import { getProviderShortLabel } from "@/lib/integrations/git/provider-meta";

export type ProviderTabState =
  | "connected"
  | "available"
  | "pending"
  | "unavailable";

export type ProviderTabOption = {
  provider: GitProvider;
  state: ProviderTabState;
  hint?: string;
};

type RepoPickerProps = {
  providerOptions: ProviderTabOption[];
  provider: GitProvider;
  onProviderChange: (p: GitProvider) => void;
  onConnectProvider?: (p: GitProvider) => void;
  repos: GitRepo[];
  reposLoading: boolean;
  selected: GitRepo | null;
  onSelect: (repo: GitRepo) => void;
  /** Opens project-scoped linked-repo picker (Version Control settings). */
  onManageRepos?: () => void;
  /** Create OneWork platform repo for the current project. */
  onCreateRepo?: () => void;
  createRepoLoading?: boolean;
  disabled?: boolean;
  /** When false, repo dropdown and actions are hidden (e.g. provider not connected). */
  repoPickerEnabled?: boolean;
};

function tabDotClass(state: ProviderTabState): string {
  if (state === "connected") return "bg-emerald-400";
  if (state === "pending") return "bg-amber-400";
  if (state === "available") return "bg-text-secondary/50";
  return "bg-transparent";
}

export default function RepoPicker({
  providerOptions,
  provider,
  onProviderChange,
  onConnectProvider,
  repos,
  reposLoading,
  selected,
  onSelect,
  onManageRepos,
  onCreateRepo,
  createRepoLoading = false,
  disabled = false,
  repoPickerEnabled = true,
}: RepoPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visibleOptions = useMemo(
    () => providerOptions.filter((o) => o.state !== "unavailable"),
    [providerOptions],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repos, query]);

  const showCreateFooter =
    provider === "onework" &&
    !reposLoading &&
    repos.length === 0 &&
    onCreateRepo;

  const placeholder =
    provider === "onework" && repos.length === 0 && !reposLoading
      ? "No repository yet"
      : "Select repository";

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const handleTabClick = (opt: ProviderTabOption) => {
    if (disabled) return;
    if (opt.state === "available") {
      onConnectProvider?.(opt.provider);
      return;
    }
    if (opt.state === "connected" || opt.state === "pending") {
      onProviderChange(opt.provider);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 min-w-0">
      {visibleOptions.length > 0 && (
        <div className="flex gap-1 p-1 bg-surface-dark rounded-lg border border-border-dark shrink-0">
          {visibleOptions.map((opt) => {
            const isActive = provider === opt.provider;
            const isMuted = opt.state === "available";
            return (
              <button
                key={opt.provider}
                type="button"
                title={opt.hint}
                onClick={() => handleTabClick(opt)}
                disabled={disabled}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold uppercase disabled:opacity-50 disabled:cursor-not-allowed ${
                  isActive
                    ? "bg-primary text-white"
                    : isMuted
                      ? "text-text-secondary/70 hover:text-text-secondary"
                      : "text-text-secondary hover:text-main disabled:hover:text-text-secondary"
                }`}
              >
                <span
                  className={`size-1.5 rounded-full shrink-0 ${tabDotClass(opt.state)}`}
                  aria-hidden
                />
                {getProviderShortLabel(opt.provider)}
              </button>
            );
          })}
        </div>
      )}
      {repoPickerEnabled && (
        <>
          <div className="relative min-w-[12rem] flex-1 max-w-md">
            <button
              type="button"
              onClick={() => !disabled && setOpen((v) => !v)}
              disabled={disabled}
              className="w-full h-10 text-left flex items-center justify-between gap-2 px-3 rounded-lg bg-background-dark border border-border-dark text-sm font-bold text-main disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="truncate">
                {selected?.fullName || placeholder}
              </span>
              <span className="material-symbols-outlined text-text-secondary shrink-0 text-[20px]">
                expand_more
              </span>
            </button>
            {open && (
              <div className="absolute z-[60] mt-2 w-full max-w-md max-h-72 overflow-hidden rounded-xl border border-border-dark bg-surface-dark shadow-2xl">
                <div className="p-2 border-b border-border-dark">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={disabled}
                    placeholder="Search repositories..."
                    className="w-full bg-background-dark border border-border-dark rounded-lg px-3 py-2 text-xs text-main disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="overflow-y-auto max-h-56">
                  {reposLoading && (
                    <div className="p-4 text-center text-xs text-text-secondary italic">
                      Loading…
                    </div>
                  )}
                  {!reposLoading &&
                    filtered.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          if (disabled) return;
                          onSelect(r);
                          setOpen(false);
                        }}
                        disabled={disabled}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 text-main truncate disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        {r.fullName}
                      </button>
                    ))}
                  {!reposLoading && filtered.length === 0 && !showCreateFooter && (
                    <div className="p-4 text-center text-xs text-text-secondary italic">
                      {repos.length === 0 ? "No repositories" : "No matches"}
                    </div>
                  )}
                  {showCreateFooter && (
                    <div className="p-2 border-t border-border-dark">
                      <button
                        type="button"
                        onClick={() => {
                          if (disabled || createRepoLoading) return;
                          setOpen(false);
                          onCreateRepo();
                        }}
                        disabled={disabled || createRepoLoading}
                        className="w-full text-left px-3 py-2 text-[11px] font-bold text-primary hover:bg-primary/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        {createRepoLoading ? "Creating…" : "Create repository"}
                      </button>
                    </div>
                  )}
                  {onManageRepos && (
                    <div className="p-2 border-t border-border-dark">
                      <button
                        type="button"
                        onClick={() => {
                          if (disabled) return;
                          setOpen(false);
                          onManageRepos();
                        }}
                        disabled={disabled}
                        className="w-full text-left px-3 py-2 text-[11px] font-bold text-primary hover:bg-primary/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        Manage linked repositories…
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {onManageRepos ? (
            <button
              type="button"
              onClick={() => {
                if (!disabled) onManageRepos();
              }}
              disabled={disabled}
              className="shrink-0 h-10 px-2.5 rounded-lg border border-border-dark bg-surface-dark/50 text-[11px] font-bold text-primary hover:bg-primary/10 hover:border-primary/30 transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface-dark/50 disabled:hover:border-border-dark"
            >
              Manage repos
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
