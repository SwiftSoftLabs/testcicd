"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import type { GitProvider, GitRepo } from "@/types/git";

export interface GitLinkedReposModalProps {
  onClose: () => void;
  workspaceId: string;
  projectId: string;
  provider: GitProvider;
  onSaved?: () => void | Promise<void>;
}

const PER_PAGE = 30;
const SEARCH_DEBOUNCE_MS = 320;
const ALL_TAB = "__all__";

function repoMatchesSearch(r: GitRepo, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const owner = r.owner.toLowerCase();
  const name = r.name.toLowerCase();
  const full = r.fullName.toLowerCase();
  if (full.includes(s) || owner.includes(s) || name.includes(s)) return true;
  return full.split("/").some((seg) => seg.includes(s));
}

function tabLabel(key: string, maxLen = 22): string {
  if (key === ALL_TAB) return "All";
  if (key.length <= maxLen) return key;
  return `${key.slice(0, maxLen - 1)}…`;
}

export default function GitLinkedReposModal({
  onClose,
  workspaceId,
  projectId,
  provider,
  onSaved,
}: GitLinkedReposModalProps) {
  const [catalog, setCatalog] = useState<GitRepo[]>([]);
  /** Linked repos may not appear in the first API page — keep them so selection survives search/paging */
  const [linkedSnapshot, setLinkedSnapshot] = useState<GitRepo[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogHasMore, setCatalogHasMore] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(
      () => setDebouncedSearch(searchInput.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const loadLinked = useCallback(async () => {
    const linked = await api.integrations.git.linkedRepos.list(
      workspaceId,
      projectId,
      provider,
    );
    setLinkedSnapshot(linked);
    setSelectedIds(new Set(linked.map((r) => r.id)));
  }, [workspaceId, projectId, provider]);

  useEffect(() => {
    let cancelled = false;
    setInitialLoading(true);
    void (async () => {
      try {
        await loadLinked();
      } catch {
        if (!cancelled) setSelectedIds(new Set());
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLinked]);

  const fetchCatalogPage = useCallback(
    async (page: number, q: string, append: boolean) => {
      setCatalogLoading(true);
      try {
        const rows = await api.integrations.git.repos(
          provider,
          workspaceId,
          q.trim() || undefined,
          page,
        );
        setCatalogHasMore(rows.length >= PER_PAGE);
        setCatalog((prev) => {
          const merged = append ? [...prev, ...rows] : rows;
          const byId = new Map<string, GitRepo>();
          for (const r of merged) {
            byId.set(r.id, r);
          }
          return Array.from(byId.values());
        });
        setCatalogPage(page);
      } finally {
        setCatalogLoading(false);
      }
    },
    [provider, workspaceId],
  );

  useEffect(() => {
    setCatalog([]);
    setCatalogPage(1);
    setCatalogHasMore(true);
    void fetchCatalogPage(1, debouncedSearch, false);
  }, [fetchCatalogPage, debouncedSearch, provider, workspaceId]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const mergedRepos = useMemo(() => {
    const byId = new Map<string, GitRepo>();
    for (const r of catalog) {
      byId.set(r.id, r);
    }
    for (const r of linkedSnapshot) {
      if (!byId.has(r.id)) byId.set(r.id, r);
    }
    return Array.from(byId.values());
  }, [catalog, linkedSnapshot]);

  const visibleRepos = useMemo(
    () => mergedRepos.filter((r) => repoMatchesSearch(r, searchInput)),
    [mergedRepos, searchInput],
  );

  const groupedByOwner = useMemo(() => {
    const groupKey = (r: GitRepo) => {
      const parts = r.fullName.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return parts.slice(0, -1).join("/");
      }
      return r.owner || parts[0] || "Other";
    };
    const m = new Map<string, GitRepo[]>();
    for (const r of visibleRepos) {
      const key = groupKey(r);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    for (const list of m.values()) {
      list.sort((a, b) =>
        a.fullName.localeCompare(b.fullName, undefined, {
          sensitivity: "base",
        }),
      );
    }
    return [...m.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { sensitivity: "base" }),
    );
  }, [visibleRepos]);

  const groupKeys = useMemo(
    () => groupedByOwner.map(([k]) => k),
    [groupedByOwner],
  );

  useEffect(() => {
    if (activeTab === ALL_TAB) return;
    if (!groupKeys.includes(activeTab)) {
      setActiveTab(ALL_TAB);
    }
  }, [groupKeys, activeTab]);

  const currentTabRepos = useMemo(() => {
    if (activeTab === ALL_TAB) return visibleRepos;
    const entry = groupedByOwner.find(([k]) => k === activeTab);
    return entry?.[1] ?? [];
  }, [activeTab, visibleRepos, groupedByOwner]);

  const selectedInTabCount = useMemo(
    () => currentTabRepos.filter((r) => selectedIds.has(r.id)).length,
    [currentTabRepos, selectedIds],
  );

  const allInTabSelected =
    currentTabRepos.length > 0 &&
    currentTabRepos.every((r) => selectedIds.has(r.id));

  const selectAllInTab = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of currentTabRepos) next.add(r.id);
      return next;
    });
  };

  const deselectAllInTab = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of currentTabRepos) next.delete(r.id);
      return next;
    });
  };

  const selectedReposPayload = useMemo(() => {
    return mergedRepos.filter((r) => selectedIds.has(r.id));
  }, [mergedRepos, selectedIds]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.integrations.git.linkedRepos.save({
        workspaceId,
        projectId,
        provider,
        repos: selectedReposPayload.map((r) => ({
          id: r.id,
          owner: r.owner,
          name: r.name,
          fullName: r.fullName,
          private: r.private,
          defaultBranch: r.defaultBranch,
          htmlUrl: r.htmlUrl,
          cloneUrl: r.cloneUrl,
          sshUrl: r.sshUrl,
          description: r.description,
          homepage: r.homepage,
          license: r.license,
          stargazersCount: r.stargazersCount,
          updatedAt: r.updatedAt,
        })),
      });
      await onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save selection");
    } finally {
      setSaving(false);
    }
  };

  const providerLabel = provider === "github" ? "GitHub" : "GitLab";

  return (
    <div className="bg-surface-dark border border-border-dark rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl text-main animate-in zoom-in-95 duration-200">
      <div className="p-6 border-b border-border-dark shrink-0">
        <h2 className="text-lg font-bold text-white">
          Repositories for Version Control
        </h2>
        <p className="text-xs text-text-secondary mt-1 leading-relaxed">
          {providerLabel} • Choose which repositories appear for this project.
          Search matches <span className="text-main/90">organization</span>,{" "}
          <span className="text-main/90">owner</span>, or{" "}
          <span className="text-main/90">repository name</span>.
        </p>
      </div>
      <div className="p-4 border-b border-border-dark shrink-0 space-y-2">
        <div className="relative">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-[20px]">
            search
          </span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by owner, organization, or repo name…"
            className="w-full bg-background-dark border border-border-dark rounded-xl pl-10 pr-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-primary placeholder:text-text-secondary/70"
          />
        </div>
        {searchInput.trim() !== debouncedSearch && (
          <p className="text-[10px] text-text-secondary px-0.5">
            Updating list from provider…
          </p>
        )}
      </div>

      {!initialLoading && groupedByOwner.length > 0 && (
        <div className="shrink-0 border-b border-border-dark px-2 pt-2 pb-0">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 px-1">
            <button
              type="button"
              onClick={() => setActiveTab(ALL_TAB)}
              title="All matching repositories"
              className={`cursor-pointer shrink-0 flex items-center gap-2 px-3 py-2 rounded-t-lg border border-b-0 text-xs font-bold transition-colors ${
                activeTab === ALL_TAB
                  ? "bg-primary text-white border-primary shadow-md"
                  : "bg-background-dark text-text-secondary border-border-dark hover:text-main hover:border-border-dark"
              }`}
            >
              All
              <span
                className={`tabular-nums text-[10px] px-1.5 py-0.5 rounded-full ${
                  activeTab === ALL_TAB ? "bg-white/20" : "bg-white/5"
                }`}
              >
                {visibleRepos.length}
              </span>
            </button>
            {groupedByOwner.map(([key, repos]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                title={key}
                className={`cursor-pointer shrink-0 flex items-center gap-2 max-w-[200px] px-3 py-2 rounded-t-lg border border-b-0 text-xs font-bold transition-colors ${
                  activeTab === key
                    ? "bg-primary text-white border-primary shadow-md"
                    : "bg-background-dark text-text-secondary border-border-dark hover:text-main hover:border-border-dark"
                }`}
              >
                <span className="truncate font-mono font-semibold">
                  {tabLabel(key, 20)}
                </span>
                <span
                  className={`shrink-0 tabular-nums text-[10px] px-1.5 py-0.5 rounded-full ${
                    activeTab === key ? "bg-white/20" : "bg-white/5"
                  }`}
                >
                  {repos.length}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 bg-background-dark/40 border-t border-border-dark/80 rounded-b-lg mb-1">
            <p className="text-[10px] text-text-secondary px-1">
              {activeTab === ALL_TAB ? (
                <>Showing every repo matching your search.</>
              ) : (
                <>
                  Namespace:{" "}
                  <span className="font-mono text-main">{activeTab}</span>
                </>
              )}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={selectAllInTab}
                disabled={currentTabRepos.length === 0 || allInTabSelected}
                className="cursor-pointer text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 disabled:pointer-events-none"
              >
                Select all{activeTab === ALL_TAB ? " visible" : " in tab"}
              </button>
              <button
                type="button"
                onClick={deselectAllInTab}
                disabled={
                  currentTabRepos.length === 0 || selectedInTabCount === 0
                }
                className="cursor-pointer text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border border-border-dark text-text-secondary hover:text-main hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none"
              >
                Deselect all{activeTab === ALL_TAB ? " visible" : " in tab"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-1 py-2">
        {initialLoading && (
          <div className="p-8 text-center text-sm text-text-secondary">
            Loading current selection…
          </div>
        )}
        {!initialLoading && catalogLoading && catalog.length === 0 && (
          <div className="p-8 text-center text-sm text-text-secondary">
            Loading repositories…
          </div>
        )}
        {!initialLoading &&
          !catalogLoading &&
          visibleRepos.length === 0 &&
          mergedRepos.length > 0 && (
            <div className="p-8 text-center text-sm text-text-secondary">
              No repositories match &ldquo;{searchInput.trim()}&rdquo;. Try
              another owner or name.
            </div>
          )}
        {!initialLoading && !catalogLoading && mergedRepos.length === 0 && (
          <div className="p-8 text-center text-sm text-text-secondary">
            No repositories found.
          </div>
        )}
        {!initialLoading &&
          currentTabRepos.map((r) => (
            <div key={`${r.id}-${r.fullName}`} className="px-1">
              <label className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 cursor-pointer border border-transparent hover:border-border-dark/60 transition-colors group mb-0.5">
                <input
                  type="checkbox"
                  className="rounded border-border-dark text-primary focus:ring-primary shrink-0 size-4"
                  checked={selectedIds.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
                <span className="material-symbols-outlined text-text-secondary group-hover:text-primary text-[20px] shrink-0">
                  {r.private ? "lock" : "folder"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-main truncate">
                      {r.name}
                    </span>
                    {r.private && (
                      <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25 shrink-0">
                        Private
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-text-secondary truncate mt-0.5">
                    {r.fullName}
                  </div>
                </div>
              </label>
            </div>
          ))}
        {catalogHasMore && !catalogLoading && catalog.length > 0 && (
          <div className="p-3 flex justify-center">
            <button
              type="button"
              onClick={() =>
                void fetchCatalogPage(catalogPage + 1, debouncedSearch, true)
              }
              className="cursor-pointer text-xs font-bold text-primary hover:underline px-4 py-2 rounded-lg border border-primary/25 hover:bg-primary/10"
            >
              Load more
            </button>
          </div>
        )}
        {catalogLoading && catalog.length > 0 && (
          <div className="p-2 text-center text-[10px] text-text-secondary">
            Loading more…
          </div>
        )}
      </div>
      {error && (
        <div className="px-4 py-2 text-xs text-red-400 border-t border-border-dark">
          {error}
        </div>
      )}
      <div className="p-4 border-t border-border-dark flex justify-between gap-3 shrink-0 bg-surface-dark/80">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer px-4 py-2 rounded-xl text-xs font-bold text-text-secondary hover:text-white"
        >
          Cancel
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="cursor-pointer px-3 py-2 rounded-xl text-xs font-bold border border-border-dark text-text-secondary hover:text-white"
          >
            Clear all
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="cursor-pointer px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold disabled:opacity-50 shadow-lg shadow-primary/15"
          >
            {saving ? "Saving…" : `Save (${selectedIds.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
