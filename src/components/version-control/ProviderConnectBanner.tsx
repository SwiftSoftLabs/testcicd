"use client";

import Link from "next/link";

import { getProviderLabel } from "@/lib/integrations/git/provider-meta";
import type { GitProvider } from "@/types/git";

type ProviderConnectBannerProps = {
  provider: GitProvider;
  variant: "connect" | "onework-pending";
  provisionError?: string | null;
  oauthStartUrl?: string;
  onRetry?: () => void;
  retryLoading?: boolean;
};

export default function ProviderConnectBanner({
  provider,
  variant,
  provisionError,
  oauthStartUrl,
  onRetry,
  retryLoading = false,
}: ProviderConnectBannerProps) {
  if (variant === "onework-pending") {
    return (
      <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-bold text-main">
            OneWork Version Control setup required
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {provisionError
              ? provisionError
              : "Your workspace Git account is being provisioned. Retry setup, then create a repository for this project."}
          </p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retryLoading}
            className="shrink-0 h-9 px-4 rounded-lg border border-border-dark bg-surface-dark text-sm font-bold text-main hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {retryLoading ? "Retrying…" : "Retry setup"}
          </button>
        )}
      </div>
    );
  }

  const label = getProviderLabel(provider);

  return (
    <div className="mb-6 rounded-2xl border border-border-dark bg-surface-dark/40 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-main">
          Connect {label} to browse repositories
        </p>
        <p className="text-xs text-text-secondary mt-1">
          Link your {label} account in settings, then choose which repositories
          belong to this project.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <Link
          href="/settings/git-ssh"
          className="h-9 px-4 rounded-lg border border-border-dark bg-surface-dark text-sm font-bold text-main hover:bg-white/5 inline-flex items-center justify-center"
        >
          Open Git &amp; SSH
        </Link>
        {oauthStartUrl && (
          <a
            href={oauthStartUrl}
            className="h-9 px-4 rounded-lg bg-primary hover:bg-blue-600 text-white text-sm font-bold inline-flex items-center justify-center"
          >
            Connect {label}
          </a>
        )}
      </div>
    </div>
  );
}
