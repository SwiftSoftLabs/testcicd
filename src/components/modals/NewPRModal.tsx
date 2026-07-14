"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { useUIContext } from "@/context/UIContext";
import { useClickOutside } from "@/hooks/useClickOutside";
import { api } from "@/lib/api";
import { parseVcPullId } from "@/lib/integrations/git/vc-pull-id";
import type { GitBranchInfo, GitProvider } from "@/types/git";

export interface NewPRModalProps {
  onClose: () => void;
  workspaceId: string;
  projectId?: string;
  provider: GitProvider;
  owner: string;
  repo: string;
  defaultBase: string;
  defaultCompare: string;
  branches: GitBranchInfo[];
  onCreated?: () => void;
}

function BranchSearchSelect({
  label,
  value,
  onChange,
  branches,
  exclude,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  branches: GitBranchInfo[];
  exclude?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return branches
      .map((b) => b.name)
      .filter((n) => (exclude ? n !== exclude : true))
      .filter((n) => !qq || n.toLowerCase().includes(qq));
  }, [branches, q, exclude]);

  return (
    <div className="relative flex-1 min-w-0" ref={rootRef}>
      <span className="text-[10px] font-bold text-text-secondary block uppercase text-center mb-1 tracking-wide">
        {label}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="cursor-pointer w-full flex items-center justify-center gap-1 rounded-lg border border-border-dark bg-background-dark/80 px-2 py-2 text-xs font-mono text-center text-main hover:bg-white/5 disabled:opacity-50 disabled:pointer-events-none"
      >
        <span className="truncate">{value || "—"}</span>
        <span className="material-symbols-outlined text-[18px] shrink-0 text-text-secondary">
          expand_more
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[60] mt-1 rounded-xl border border-border-dark bg-surface-dark shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-border-dark">
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search branches…"
              className="w-full rounded-lg bg-background-dark border border-border-dark text-xs text-main px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <ul
            className="max-h-52 overflow-y-auto py-1"
            role="listbox"
            aria-label={`${label} branches`}
          >
            {branches.length === 0 ? (
              <li className="px-3 py-2 text-xs text-text-secondary italic">
                Loading branches…
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-text-secondary italic">
                No matching branches
              </li>
            ) : (
              filtered.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    role="option"
                    className="cursor-pointer w-full text-left px-3 py-2 text-xs font-mono text-main hover:bg-white/5 flex items-center justify-between gap-2"
                    onClick={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{name}</span>
                    {branches.find((b) => b.name === name)?.isDefault ? (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-text-secondary shrink-0">
                        default
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

const NewPRModal: React.FC<NewPRModalProps> = ({
  onClose,
  workspaceId,
  projectId,
  provider,
  owner,
  repo,
  defaultBase,
  defaultCompare,
  branches: branchesProp,
  onCreated,
}) => {
  const { addToast } = useUIContext();
  const modalRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [base, setBase] = useState(defaultBase);
  const [head, setHead] = useState(defaultCompare);
  const [createAsDraft, setCreateAsDraft] = useState(false);
  const [templates, setTemplates] = useState<
    Array<{ path: string; name: string; content: string }>
  >([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fetchedBranches, setFetchedBranches] = useState<
    GitBranchInfo[] | null
  >(null);

  useClickOutside(modalRef, onClose);

  useEffect(() => {
    setBase(defaultBase);
    setHead(defaultCompare);
  }, [defaultBase, defaultCompare]);

  useEffect(() => {
    if (branchesProp.length > 0) {
      setFetchedBranches(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const b = await api.integrations.git.branches(
          provider,
          workspaceId,
          owner,
          repo,
        );
        if (!cancelled) setFetchedBranches(b);
      } catch {
        if (!cancelled) setFetchedBranches([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchesProp.length, workspaceId, provider, owner, repo]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.integrations.git.pullTemplates(
          provider,
          workspaceId,
          owner,
          repo,
        );
        if (!cancelled) setTemplates(res.templates ?? []);
      } catch {
        if (!cancelled) setTemplates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, provider, owner, repo]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const tpl = templates.find((t) => t.path === selectedTemplate);
    if (tpl) setDescription(tpl.content);
  }, [selectedTemplate, templates]);

  const branches =
    branchesProp.length > 0 ? branchesProp : (fetchedBranches ?? []);
  const loadingBranches = branchesProp.length === 0 && fetchedBranches === null;
  const branchesFailed =
    branchesProp.length === 0 &&
    fetchedBranches !== null &&
    branches.length === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      addToast("Enter a title for the pull request.", "warning");
      return;
    }
    if (!head.trim() || !base.trim()) {
      addToast("Base and compare branch names are required.", "warning");
      return;
    }
    if (head.trim() === base.trim()) {
      addToast("Compare branch must differ from the base branch.", "warning");
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.integrations.git.createPull(
        provider,
        workspaceId,
        owner,
        repo,
        {
          title: title.trim(),
          description: description.trim(),
          base: base.trim(),
          head: head.trim(),
          draft: createAsDraft,
          projectId,
        },
      );
      const parsed = parseVcPullId(created.id);
      const numLabel =
        parsed != null
          ? `${provider === "gitlab" ? "!" : "#"}${parsed.number}`
          : "";
      addToast(`Pull request ${numLabel || "created"} opened.`, "success");
      if (created.html_url) {
        window.open(created.html_url, "_blank", "noopener,noreferrer");
      }
      onCreated?.();
      onClose();
    } catch (err: unknown) {
      addToast(
        err instanceof Error ? err.message : "Failed to create pull request.",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const providerLabel =
    provider === "github"
      ? "GitHub"
      : provider === "gitlab"
        ? "GitLab"
        : "OneWork";

  return (
    <div
      ref={modalRef}
      className="max-w-xl mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
    >
      <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between bg-white/[0.02]">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">
            merge_type
          </span>
          New pull request
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer text-text-secondary hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-5">
        <p className="text-xs text-text-secondary leading-relaxed">
          Opens a PR on {providerLabel} for{" "}
          <span className="font-mono text-main">
            {owner}/{repo}
          </span>
          . Merging and reviews still happen on {providerLabel}.
        </p>

        <div className="flex items-stretch gap-2 bg-background-dark/50 p-3 rounded-xl border border-border-dark">
          <BranchSearchSelect
            label="Base"
            value={base}
            onChange={setBase}
            branches={branches}
            exclude={head}
            disabled={loadingBranches || branchesFailed}
          />
          <div className="flex flex-col justify-end pb-2 shrink-0" aria-hidden>
            <span className="material-symbols-outlined text-text-secondary text-[20px]">
              arrow_back
            </span>
          </div>
          <BranchSearchSelect
            label="Compare"
            value={head}
            onChange={setHead}
            branches={branches}
            exclude={base}
            disabled={loadingBranches || branchesFailed}
          />
        </div>
        {loadingBranches ? (
          <p className="text-[11px] text-text-secondary -mt-2">
            Loading branch list…
          </p>
        ) : branchesFailed ? (
          <p className="text-[11px] text-amber-400/90 -mt-2">
            Could not load branches. Close the dialog and try again.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
            Title
          </label>
          <input
            autoFocus
            data-autofocus="true"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Refactor navigation logic"
            className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
            Template
          </label>
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
            className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm px-4 py-2.5 outline-none"
          >
            <option value="">Blank description</option>
            {templates.map((tpl) => (
              <option key={tpl.path} value={tpl.path}>
                {tpl.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
            Description
          </label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-background-dark border border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 resize-none transition-all outline-none"
            placeholder="What does this change do?"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={createAsDraft}
            onChange={(e) => setCreateAsDraft(e.target.checked)}
            className="rounded border-border-dark"
          />
          Create as draft
        </label>

        <div className="flex justify-end gap-3 pt-2">
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
            disabled={
              submitting ||
              loadingBranches ||
              branchesFailed ||
              branches.length === 0
            }
            className="cursor-pointer px-6 py-2 bg-primary text-white text-sm font-bold rounded-lg shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create pull request"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default NewPRModal;
