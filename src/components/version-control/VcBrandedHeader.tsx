"use client";

import Link from "next/link";

import {
  getProviderLabel,
  getProviderShortLabel,
  GIT_PROVIDER_META,
} from "@/lib/integrations/git/provider-meta";
import type { GitProvider } from "@/types/git";

type VcBrandedHeaderProps = {
  provider: GitProvider;
  projectName?: string | null;
  projectId?: string | null;
  pullLabel?: string | null;
  breadcrumbs?: Array<{ label: string; href?: string }>;
};

export default function VcBrandedHeader({
  provider,
  projectName,
  projectId,
  pullLabel,
  breadcrumbs,
}: VcBrandedHeaderProps) {
  const meta = GIT_PROVIDER_META[provider];
  const items =
    breadcrumbs ??
    [
      { label: "Version Control", href: "/version-control" },
      projectName && projectId
        ? {
            label: projectName,
            href: `/version-control?projectId=${encodeURIComponent(projectId)}`,
          }
        : null,
      pullLabel ? { label: pullLabel } : null,
    ].filter((item): item is { label: string; href?: string } => Boolean(item));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-primary"
          style={{ borderColor: meta.isPlatformManaged ? undefined : `#${meta.color}40` }}
        >
          <span className="material-symbols-outlined text-[14px]">
            {meta.icon === "github" || meta.icon === "gitlab"
              ? "hub"
              : "account_tree"}
          </span>
          {getProviderShortLabel(provider)}
        </span>
        <span className="text-[10px] text-text-secondary font-medium">
          {getProviderLabel(provider)}
        </span>
      </div>
      {items.length > 0 ? (
        <nav
          className="flex flex-wrap items-center gap-1.5 text-xs text-text-secondary"
          aria-label="Breadcrumb"
        >
          {items.map((item, index) => (
            <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1.5">
              {index > 0 ? (
                <span className="text-text-secondary/40" aria-hidden>
                  /
                </span>
              ) : null}
              {item.href ? (
                <Link
                  href={item.href}
                  className="font-semibold text-primary hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="font-semibold text-main">{item.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
