"use client";

import React from "react";

/** Gradient used on AI titles, sparkle, and icon accents only — not fills. */
export const AI_GRADIENT_TEXT = "from-violet-400 via-sky-400 to-fuchsia-400";
export const AI_GRADIENT_BORDER =
  "from-violet-500/45 via-primary/55 to-fuchsia-500/40";

export function aiGradientTextClass() {
  return `bg-gradient-to-r ${AI_GRADIENT_TEXT} bg-clip-text text-transparent`;
}

function cn(...parts: (string | false | undefined | null)[]) {
  return parts.filter(Boolean).join(" ");
}

export type AiUiSize = "xs" | "sm" | "md";

const iconSize: Record<AiUiSize, string> = {
  xs: "text-[13px]",
  sm: "text-[16px]",
  md: "text-[18px]",
};

const badgeSize: Record<AiUiSize, string> = {
  xs: "size-6",
  sm: "size-7",
  md: "size-8",
};

/** Sparkle icon with gradient (no background). */
export function AiSparkle({
  size = "sm",
  className,
  filled = true,
}: {
  size?: AiUiSize;
  className?: string;
  filled?: boolean;
}) {
  return (
    <span
      className={cn(
        "material-symbols-outlined shrink-0 bg-gradient-to-br bg-clip-text text-transparent",
        AI_GRADIENT_TEXT,
        iconSize[size],
        className,
      )}
      style={filled ? { fontVariationSettings: '"FILL" 1' } : undefined}
      aria-hidden
    >
      auto_awesome
    </span>
  );
}

/** Small bordered frame for the sparkle — border + icon only. */
export function AiIconBadge({
  size = "sm",
  className,
}: {
  size?: AiUiSize;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg border border-violet-500/35 bg-surface-dark",
        badgeSize[size],
        className,
      )}
    >
      <AiSparkle size={size === "md" ? "sm" : "xs"} />
    </span>
  );
}

/** Gradient “AI” word only (optional, use sparingly). */
export function AiLabel({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-[9px] font-black uppercase tracking-wider",
        aiGradientTextClass(),
        className,
      )}
    >
      AI
    </span>
  );
}

export function AiHeading({
  title,
  subtitle,
  className,
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      <AiIconBadge size="md" />
      <div className="min-w-0">
        <p
          className={cn(
            "text-xs font-black uppercase tracking-wide",
            aiGradientTextClass(),
          )}
        >
          {title}
        </p>
        {subtitle ? (
          <p className="text-[11px] text-text-secondary truncate">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Card with gradient border only; solid inner surface. */
export function AiBorderCard({
  children,
  className,
  innerClassName,
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-[1px] bg-gradient-to-r",
        AI_GRADIENT_BORDER,
        className,
      )}
    >
      <div className={cn("rounded-[11px] bg-surface-dark", innerClassName)}>
        {children}
      </div>
    </div>
  );
}

/** Action chip — neutral fill, gradient border on hover, gradient icon. */
export function AiChip({
  children,
  onClick,
  disabled,
  busy,
  icon,
  className,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      onClick={onClick}
      className={cn(
        "cursor-pointer inline-flex items-center gap-1.5 rounded-xl border border-border-dark bg-surface-dark/80 px-3 py-2",
        "text-left text-xs font-semibold text-main",
        "hover:border-violet-500/40 transition-colors",
        "disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed",
        className,
      )}
    >
      {busy ? (
        <span className="size-3.5 border-2 border-violet-400/30 border-t-violet-300 rounded-full animate-spin shrink-0" />
      ) : icon ? (
        <span
          className={cn(
            "material-symbols-outlined shrink-0 text-[16px]",
            aiGradientTextClass(),
          )}
        >
          {icon}
        </span>
      ) : (
        <AiSparkle size="xs" />
      )}
      {children}
    </button>
  );
}

/** Compact control — one gradient icon, no duplicate badges. */
export function AiIconButton({
  title,
  onClick,
  disabled,
  busy,
  icon = "task_alt",
  className,
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "cursor-pointer inline-flex items-center justify-center p-1 rounded-md border border-transparent",
        "hover:border-violet-500/40 hover:bg-white/10",
        "disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
        className,
      )}
    >
      {busy ? (
        <span className="size-3.5 border-2 border-violet-400/30 border-t-violet-300 rounded-full animate-spin" />
      ) : (
        <span
          className={cn(
            "material-symbols-outlined text-[14px]",
            aiGradientTextClass(),
          )}
          style={{ fontVariationSettings: '"FILL" 1' }}
          aria-hidden
        >
          {icon}
        </span>
      )}
    </button>
  );
}

/**
 * Chat message toolbar — sparkle + task icon on a subtle AI tint.
 * (Material icons do not pick up bg-clip-text gradients; use accent colors + background.)
 */
export function AiMessageTaskButton({
  title = "Create task with AI",
  onClick,
  disabled,
  busy,
  className,
}: {
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "cursor-pointer inline-flex items-center gap-0.5 rounded-md px-1 py-0.5",
        "border border-violet-500/35",
        "bg-violet-500/[0.12] hover:bg-violet-500/[0.18] hover:border-violet-400/50",
        "disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
        className,
      )}
    >
      {busy ? (
        <span className="size-3.5 border-2 border-violet-400/30 border-t-violet-300 rounded-full animate-spin" />
      ) : (
        <>
          <span
            className="material-symbols-outlined text-[13px] text-fuchsia-400"
            style={{ fontVariationSettings: '"FILL" 1' }}
            aria-hidden
          >
            auto_awesome
          </span>
          <span
            className="material-symbols-outlined text-[14px] text-violet-300"
            style={{ fontVariationSettings: '"FILL" 1' }}
            aria-hidden
          >
            task_alt
          </span>
        </>
      )}
    </button>
  );
}

/**
 * Compact header/toolbar AI control — thin border, light tint (no thick gradient ring).
 */
export function AiOutlineButton({
  children,
  onClick,
  disabled,
  busy,
  icon,
  className,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      onClick={onClick}
      className={cn(
        "cursor-pointer inline-flex items-center gap-1 rounded-md border border-violet-500/30",
        "bg-violet-500/[0.08] px-2 py-1 text-[11px] font-semibold",
        "hover:bg-violet-500/[0.14] hover:border-violet-400/45",
        "disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed transition-colors",
        className,
      )}
    >
      {busy ? (
        <span className="size-3 border-2 border-violet-400/30 border-t-violet-300 rounded-full animate-spin shrink-0" />
      ) : (
        <>
          <AiSparkle size="xs" />
          {icon ? (
            <span className="material-symbols-outlined text-[14px] text-violet-300/90">
              {icon}
            </span>
          ) : null}
        </>
      )}
      <span className={aiGradientTextClass()}>{children}</span>
    </button>
  );
}

/** Primary AI action — gradient border ring, neutral interior, gradient label. */
export function AiGradientButton({
  children,
  onClick,
  disabled,
  busy,
  icon,
  className,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-lg p-[1px] bg-gradient-to-r",
        AI_GRADIENT_BORDER,
        disabled && "opacity-40 pointer-events-none",
        className,
      )}
    >
      <button
        type={type}
        disabled={disabled || busy}
        onClick={onClick}
        className={cn(
          "cursor-pointer inline-flex items-center gap-1.5 rounded-[7px] bg-surface-dark px-3 py-2 text-xs font-bold",
          "hover:bg-white/[0.04] transition-colors w-full disabled:cursor-not-allowed",
        )}
      >
        {busy ? (
          <span className="size-3.5 border-2 border-violet-400/30 border-t-violet-300 rounded-full animate-spin shrink-0" />
        ) : icon ? (
          <span
            className={cn(
              "material-symbols-outlined text-[16px]",
              aiGradientTextClass(),
            )}
          >
            {icon}
          </span>
        ) : (
          <AiSparkle size="xs" />
        )}
        <span className={aiGradientTextClass()}>{children}</span>
      </button>
    </span>
  );
}

/** Panel — gradient border only; inner surface is flat. */
export function AiPanel({
  children,
  header,
  open,
  onToggle,
  collapsible = true,
  className,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  open?: boolean;
  onToggle?: () => void;
  collapsible?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl p-[1px] bg-gradient-to-r",
        AI_GRADIENT_BORDER,
        className,
      )}
    >
      <div className="rounded-[15px] bg-surface-dark overflow-hidden">
        {collapsible && onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className="cursor-pointer flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
            aria-expanded={open}
          >
            {header}
            <span className="material-symbols-outlined text-text-secondary text-[20px] shrink-0">
              {open ? "expand_less" : "expand_more"}
            </span>
          </button>
        ) : (
          <div className="px-4 py-3">{header}</div>
        )}
        {(!collapsible || open) && (
          <div className="px-4 pb-4 border-t border-border-dark/50">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/** Expand/collapse AI tools — gradient text + border when open. */
export function AiToggle({
  open,
  onClick,
  label = "AI Assistant",
  className,
}: {
  open: boolean;
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors",
        open
          ? "border-violet-500/40 bg-surface-dark"
          : "border-transparent hover:border-violet-500/25 hover:bg-white/[0.03]",
        className,
      )}
    >
      <AiSparkle size="xs" />
      <span className={aiGradientTextClass()}>{label}</span>
      <span className="material-symbols-outlined text-text-secondary text-[16px]">
        {open ? "expand_less" : "expand_more"}
      </span>
    </button>
  );
}
