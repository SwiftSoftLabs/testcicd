"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import { useUIContext } from "@/context/UIContext";
import { useClickOutside } from "@/hooks/useClickOutside";
import { api } from "@/lib/api";
import { getProviderLabel } from "@/lib/integrations/git/provider-meta";
import type { GitProvider } from "@/types/git";

type CollaboratorRow = {
  id: string;
  login: string;
  avatarUrl: string | null;
  permission: string;
  htmlUrl?: string | null;
};

type RepoCollaboratorsPanelProps = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  provider: GitProvider;
  owner: string;
  repo: string;
  repoFullName: string;
  readOnly?: boolean;
  onInvite: () => void;
};

export function RepoCollaboratorsPanel({
  open,
  onClose,
  workspaceId,
  provider,
  owner,
  repo,
  repoFullName,
  readOnly,
  onInvite,
}: RepoCollaboratorsPanelProps) {
  const { addToast } = useUIContext();
  const panelRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<CollaboratorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  useClickOutside(panelRef, onClose, open);

  const reload = useCallback(async () => {
    if (!workspaceId || !owner || !repo) return;
    setLoading(true);
    try {
      const data = await api.integrations.git.listCollaborators(
        provider,
        workspaceId,
        owner,
        repo,
      );
      setRows(data);
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to load collaborators",
        "error",
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, provider, owner, repo, addToast]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const remove = async (login: string) => {
    if (readOnly) return;
    if (!window.confirm(`Remove ${login} from ${repoFullName}?`)) return;
    setRemoving(login);
    try {
      await api.integrations.git.removeCollaborator(
        provider,
        workspaceId,
        owner,
        repo,
        login,
      );
      addToast(`Removed ${login}.`, "success");
      await reload();
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to remove collaborator",
        "error",
      );
    } finally {
      setRemoving(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[10vh] px-4 bg-black/50">
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Repository collaborators"
        className="w-full max-w-lg rounded-xl border border-border-dark bg-surface-dark shadow-2xl p-5"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-bold text-main">Collaborators</h2>
            <p className="text-xs text-text-secondary mt-1">
              People with access to{" "}
              <span className="font-mono text-main">{repoFullName}</span> on{" "}
              {getProviderLabel(provider)}. Workspace members are added
              automatically; you can invite others or remove access below.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-text-secondary hover:text-main"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            type="button"
            disabled={readOnly}
            onClick={onInvite}
            className="cursor-pointer h-9 px-3 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-40"
          >
            Invite
          </button>
          <button
            type="button"
            onClick={() => void reload()}
            className="cursor-pointer h-9 px-3 rounded-lg border border-border-dark text-xs font-bold text-main hover:bg-white/5"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-text-secondary py-8 text-center">
            Loading collaborators…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-text-secondary py-8 text-center italic">
            No collaborators listed yet. Use Invite to add workspace members, or
            Refresh to reload from the provider.
          </p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto space-y-2">
            {rows.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-lg border border-border-dark bg-background-dark/40 px-3 py-2"
              >
                {c.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.avatarUrl}
                    alt=""
                    className="size-8 rounded-full object-cover"
                  />
                ) : (
                  <span className="size-8 rounded-full bg-surface-highlight flex items-center justify-center text-xs font-bold text-main">
                    {c.login.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {c.htmlUrl ? (
                    <a
                      href={c.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-main hover:underline truncate block"
                    >
                      {c.login}
                    </a>
                  ) : (
                    <p className="text-sm font-semibold text-main truncate">
                      {c.login}
                    </p>
                  )}
                  <p className="text-[10px] text-text-secondary uppercase tracking-wide">
                    {c.permission}
                  </p>
                </div>
                {!readOnly ? (
                  <button
                    type="button"
                    disabled={removing === c.login}
                    onClick={() => void remove(c.login)}
                    className="cursor-pointer text-[10px] font-bold text-red-400 hover:underline disabled:opacity-40"
                  >
                    {removing === c.login ? "…" : "Remove"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
