"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { useUIContext } from "@/context/UIContext";
import { useClickOutside } from "@/hooks/useClickOutside";
import { api } from "@/lib/api";
import type { RepoCollaboratorPermission } from "@/lib/integrations/git/provider";
import type { GitProvider } from "@/types/git";

export interface InviteRepoCollaboratorModalProps {
  onClose: () => void;
  workspaceId: string;
  provider: GitProvider;
  owner: string;
  repo: string;
  repoFullName: string;
}

type OneworkMemberHandle = {
  userId: string;
  name: string;
  email: string;
  giteaUsername: string | null;
};

const PERMISSION_OPTIONS: {
  value: RepoCollaboratorPermission;
  label: string;
  hint: string;
}[] = [
  {
    value: "pull",
    label: "Read",
    hint: "Recommended for non-code contributors",
  },
  {
    value: "triage",
    label: "Triage",
    hint: "Manage issues and PRs without write access to code",
  },
  {
    value: "push",
    label: "Write",
    hint: "Read and clone; push to the repository",
  },
  {
    value: "maintain",
    label: "Maintain",
    hint: "Manage repo without admin access",
  },
  {
    value: "admin",
    label: "Admin",
    hint: "Full access including settings and collaborator management",
  },
];

const InviteRepoCollaboratorModal: React.FC<
  InviteRepoCollaboratorModalProps
> = ({ onClose, workspaceId, provider, owner, repo, repoFullName }) => {
  const { addToast, closeModal, openModal } = useUIContext();
  const modalRef = useRef<HTMLDivElement>(null);
  const [username, setUsername] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [permission, setPermission] =
    useState<RepoCollaboratorPermission>("push");
  const [submitting, setSubmitting] = useState(false);
  const [memberHandles, setMemberHandles] = useState<OneworkMemberHandle[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  useClickOutside(modalRef, onClose);

  const providerLabel =
    provider === "github"
      ? "GitHub"
      : provider === "gitlab"
        ? "GitLab"
        : "OneWork Version Control";
  const handleName =
    provider === "github"
      ? "GitHub username"
      : provider === "gitlab"
        ? "GitLab username"
        : "Gitea username";

  useEffect(() => {
    if (provider !== "onework" || !workspaceId) {
      setMemberHandles([]);
      return;
    }
    let cancelled = false;
    setLoadingMembers(true);
    void api.integrations.git
      .oneworkMemberHandles(workspaceId)
      .then((rows) => {
        if (!cancelled) setMemberHandles(rows);
      })
      .catch(() => {
        if (!cancelled) setMemberHandles([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, workspaceId]);

  const selectedMember = useMemo(
    () => memberHandles.find((m) => m.userId === selectedMemberId) ?? null,
    [memberHandles, selectedMemberId],
  );

  const resolvedUsername =
    provider === "onework"
      ? (selectedMember?.giteaUsername ?? "")
      : username.trim().replace(/^@/, "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let u = resolvedUsername.trim().replace(/^@/, "");

    if (provider === "onework") {
      if (!selectedMemberId) {
        addToast("Choose a workspace member to add.", "warning");
        return;
      }
      if (!u && selectedMember) {
        setSubmitting(true);
        try {
          const provisioned = await api.integrations.git.provisionOneworkMember(
            workspaceId,
            selectedMember.userId,
          );
          u = provisioned.giteaUsername;
        } catch (err: unknown) {
          addToast(
            err instanceof Error
              ? err.message
              : "Failed to set up Version Control for this member.",
            "error",
          );
          setSubmitting(false);
          return;
        }
      }
    }

    if (!u) {
      addToast(
        provider === "onework"
          ? "Choose a workspace member to add."
          : `Enter a ${handleName.toLowerCase()}.`,
        "warning",
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.integrations.git.addCollaborator(
        provider,
        workspaceId,
        owner,
        repo,
        {
          username: u,
          permission,
        },
      );
      addToast(result.message, result.alreadyCollaborator ? "info" : "success");
      onClose();
    } catch (err: unknown) {
      addToast(
        err instanceof Error ? err.message : "Failed to add collaborator.",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openWorkspaceInvite = () => {
    closeModal();
    requestAnimationFrame(() => {
      openModal("invite-user");
    });
  };

  return (
    <div
      ref={modalRef}
      className="max-w-md mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
    >
      <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between bg-white/[0.02]">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">
            group_add
          </span>
          Add collaborator
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer text-text-secondary hover:text-white"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-5">
        <p className="text-xs text-text-secondary leading-relaxed">
          {provider === "onework" ? (
            <>
              Pick someone from this workspace to grant access to{" "}
              <span className="font-mono text-main">{repoFullName}</span>.
              Workspace members are provisioned on OneWork Version Control
              automatically.
            </>
          ) : (
            <>
              Invites this person on{" "}
              <span className="text-main font-semibold">{providerLabel}</span> to{" "}
              <span className="font-mono text-main">{repoFullName}</span>.
            </>
          )}
        </p>

        {provider === "onework" ? (
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Workspace member
            </label>
            <select
              autoFocus
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              disabled={loadingMembers || submitting}
              className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 cursor-pointer outline-none"
            >
              <option value="">
                {loadingMembers
                  ? "Loading workspace members…"
                  : memberHandles.length === 0
                    ? "No workspace members available"
                    : "Select a member…"}
              </option>
              {memberHandles.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                  {m.giteaUsername ? ` (${m.giteaUsername})` : " (sets up VC on add)"}
                </option>
              ))}
            </select>
            {selectedMember ? (
              <p className="text-[10px] text-text-secondary px-0.5">
                {selectedMember.email}
                {selectedMember.giteaUsername ? (
                  <>
                    {" "}
                    · Gitea{" "}
                    <span className="font-mono text-main">
                      {selectedMember.giteaUsername}
                    </span>
                  </>
                ) : (
                  " · Version Control account will be created when you add them"
                )}
              </p>
            ) : (
              <p className="text-[10px] text-text-secondary px-0.5">
                All workspace members appear here. New members are added to
                Version Control when you select them.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              {handleName}
            </label>
            <input
              autoFocus
              data-autofocus="true"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={provider === "github" ? "octocat" : "gitlab-handle"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all outline-none font-mono"
            />
            <p className="text-[10px] text-text-secondary px-0.5">
              Use their {providerLabel} account handle, not their workspace
              email.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
            Repository role
          </label>
          <select
            value={permission}
            onChange={(e) =>
              setPermission(e.target.value as RepoCollaboratorPermission)
            }
            className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 cursor-pointer outline-none"
          >
            {PERMISSION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-text-secondary px-0.5">
            {PERMISSION_OPTIONS.find((o) => o.value === permission)?.hint}
          </p>
          {provider === "gitlab" ? (
            <p className="text-[10px] text-text-secondary px-0.5">
              Roles map to GitLab project access (Reporter / Developer /
              Maintainer / Owner) as closely as possible.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 pt-1">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="cursor-pointer px-4 py-2 text-text-secondary text-sm font-bold hover:text-white transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || (provider === "onework" && loadingMembers)}
              className="cursor-pointer px-6 py-2 bg-primary text-white text-sm font-bold rounded-lg shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all disabled:opacity-60"
            >
              {submitting ? "Adding…" : "Add collaborator"}
            </button>
          </div>
          <button
            type="button"
            onClick={openWorkspaceInvite}
            className="cursor-pointer text-left text-[11px] text-primary hover:underline font-semibold"
          >
            Invite someone to this workspace by email instead →
          </button>
        </div>
      </form>
    </div>
  );
};

export default InviteRepoCollaboratorModal;
