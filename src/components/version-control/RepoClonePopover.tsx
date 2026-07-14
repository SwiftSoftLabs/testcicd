"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { useUIContext } from "@/context/UIContext";
import { useClickOutside } from "@/hooks/useClickOutside";
import type { GitRepo } from "@/types/git";

function copyText(text: string): Promise<boolean> {
  if (!text) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

type OneworkSshHints = {
  oneworkSshHost?: string | null;
  oneworkSshPort?: string | null;
};

/** Inline HTTPS / SSH rows (e.g. README “Quick clone”). */
export function RepoCloneUrlPanel({
  repo,
  oneworkSshHost,
  oneworkSshPort,
}: { repo: GitRepo } & OneworkSshHints) {
  const { addToast } = useUIContext();
  const httpsUrl = repo.cloneUrl?.trim() ?? "";
  const sshUrl = repo.sshUrl?.trim() ?? "";
  const isOnework = repo.provider === "onework";
  const sshPort = oneworkSshPort?.trim() || "2222";

  const handleCopy = useCallback(
    async (url: string, label: string) => {
      if (!url) {
        addToast(`No ${label} URL to copy.`, "warning");
        return;
      }
      const ok = await copyText(url);
      addToast(
        ok ? `${label} clone URL copied.` : "Could not copy to clipboard.",
        ok ? "success" : "warning",
      );
    },
    [addToast],
  );

  const emptySshCopy = isOnework ? (
    <>
      No SSH remote was returned for this repository. Add an SSH key in{" "}
      <Link
        href="/settings/git-ssh?ssh=onework"
        className="text-primary hover:underline"
      >
        Git &amp; SSH settings
      </Link>{" "}
      to clone with SSH.
    </>
  ) : (
    <>
      No SSH remote was returned for this repository. You can still clone with
      HTTPS, or configure SSH in your{" "}
      {repo.provider === "gitlab" ? "GitLab" : "GitHub"} repo settings.
    </>
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-2">
          HTTPS
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            value={httpsUrl}
            className="flex-1 min-w-0 rounded-lg border border-border-dark bg-background-dark px-3 py-2 font-mono text-xs text-main outline-none focus:ring-1 focus:ring-primary"
            aria-label="HTTPS clone URL"
          />
          <button
            type="button"
            onClick={() => void handleCopy(httpsUrl, "HTTPS")}
            disabled={!httpsUrl}
            className="cursor-pointer shrink-0 rounded-lg border border-border-dark bg-surface-highlight px-3 py-2 text-xs font-bold text-main hover:bg-white/5 disabled:opacity-40"
          >
            Copy
          </button>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-2">
          SSH
        </p>
        {sshUrl ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                readOnly
                value={sshUrl}
                className="flex-1 min-w-0 rounded-lg border border-border-dark bg-background-dark px-3 py-2 font-mono text-xs text-main outline-none focus:ring-1 focus:ring-primary"
                aria-label="SSH clone URL"
              />
              <button
                type="button"
                onClick={() => void handleCopy(sshUrl, "SSH")}
                disabled={!sshUrl}
                className="cursor-pointer shrink-0 rounded-lg border border-border-dark bg-surface-highlight px-3 py-2 text-xs font-bold text-main hover:bg-white/5 disabled:opacity-40"
              >
                Copy
              </button>
            </div>
            {isOnework && (
              <p className="text-[10px] text-text-secondary leading-relaxed">
                Use port {sshPort}
                {oneworkSshHost ? (
                  <>
                    {" "}
                    on <span className="font-mono text-main">{oneworkSshHost}</span>
                  </>
                ) : null}
                .{" "}
                <Link
                  href="/settings/git-ssh?ssh=onework"
                  className="text-primary hover:underline"
                >
                  Add SSH key in Settings
                </Link>
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-text-secondary leading-relaxed">
            {emptySshCopy}
          </p>
        )}
      </div>
    </div>
  );
}

type RepoClonePopoverProps = {
  repo: GitRepo | null;
  disabled?: boolean;
  /** Align dropdown to trigger (header uses end). */
  align?: "start" | "end";
} & OneworkSshHints;

/**
 * GitHub-style “Code” control: open a panel to copy HTTPS or SSH clone URL.
 */
export function RepoClonePopover({
  repo,
  disabled,
  align = "end",
  oneworkSshHost,
  oneworkSshPort,
}: RepoClonePopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(wrapRef, close, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const canOpen = Boolean(repo?.cloneUrl?.trim());
  const alignClass = align === "end" ? "right-0" : "left-0";
  const isOnework = repo?.provider === "onework";

  useEffect(() => {
    setOpen(false);
  }, [repo?.id]);

  const sshDocsHref = isOnework
    ? "/settings/git-ssh?ssh=onework"
    : repo?.provider === "gitlab"
      ? "https://docs.gitlab.com/ee/user/ssh.html"
      : "https://docs.github.com/en/authentication/connecting-with-ssh";

  const sshDocsLabel = isOnework ? "Add SSH key in Settings" : "SSH keys set up";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        disabled={disabled || !canOpen}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="cursor-pointer h-9 pl-3 pr-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg shadow-emerald-900/20 transition-all flex items-center gap-1 border border-emerald-500/30"
      >
        <span className="material-symbols-outlined text-[18px]">download</span>
        <span>Clone</span>
        <span
          className={`material-symbols-outlined text-[20px] transition-transform ${open ? "rotate-180" : ""}`}
        >
          expand_more
        </span>
      </button>

      {open && repo && (
        <div
          role="dialog"
          aria-label="Clone repository"
          className={`absolute ${alignClass} top-full z-[80] mt-2 w-[min(calc(100vw-2rem),400px)] rounded-xl border border-border-dark bg-surface-dark p-4 shadow-2xl ring-1 ring-white/5`}
        >
          <p className="text-xs font-bold text-main mb-3">
            Clone this repository
          </p>
          <RepoCloneUrlPanel
            repo={repo}
            oneworkSshHost={oneworkSshHost}
            oneworkSshPort={oneworkSshPort}
          />
          <p className="mt-4 text-[10px] text-text-secondary leading-relaxed">
            Copy the URL for the protocol you use. Use SSH only if you have{" "}
            {isOnework ? (
              <Link href={sshDocsHref} className="text-primary hover:underline">
                {sshDocsLabel}
              </Link>
            ) : (
              <a
                href={sshDocsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {sshDocsLabel}
              </a>
            )}
            .
          </p>
        </div>
      )}
    </div>
  );
}
