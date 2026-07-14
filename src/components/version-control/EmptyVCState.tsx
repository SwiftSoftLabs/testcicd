"use client";

import Link from "next/link";

export default function EmptyVCState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 bg-background-dark">
      <div className="max-w-lg border border-border-dark rounded-2xl bg-surface-dark p-8 text-center">
        <span className="material-symbols-outlined text-primary text-4xl mb-3">
          hub
        </span>
        <h2 className="text-xl font-black text-main mb-2">
          Version Control unavailable
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          OneWork Version Control is included with your workspace when enabled by
          your admin. You can also connect GitHub or GitLab in settings to link
          external repositories per project.
        </p>
        <Link
          href="/settings/git-ssh"
          className="inline-flex px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold"
        >
          Open Git &amp; SSH
        </Link>
      </div>
    </div>
  );
}
