"use client";

import React from "react";
import type { AssistantSessionPhase } from "@/context/AssistantSessionContext";

interface AssistantActivityIndicatorProps {
  phase: AssistantSessionPhase;
  statusLabel: string;
  hintText: string | null;
  onCancel: () => void;
}

export default function AssistantActivityIndicator({
  phase,
  statusLabel,
  hintText,
  onCancel,
}: AssistantActivityIndicatorProps) {
  if (phase === "idle") return null;

  return (
    <div
      data-assistant-session-ignore
      data-assistant-activity-indicator
      className="pointer-events-auto fixed right-4 z-[45] flex max-w-[min(18rem,calc(100vw-2rem))] items-center gap-3 rounded-2xl border border-primary/25 bg-surface-dark/95 px-3 py-2.5 shadow-[0_12px_40px_rgba(25,93,230,0.22)] ring-1 ring-primary/15 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200"
      style={{
        bottom: "calc(var(--quick-taskbar-clearance, 0px) + 1rem)",
      }}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <button
        type="button"
        onClick={onCancel}
        className="group relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary/15 text-primary transition-colors hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        title="Cancel assistant"
        aria-label="Cancel voice assistant"
      >
        <span
          className="absolute inset-0 rounded-full border border-primary/30 animate-ping opacity-40"
          aria-hidden="true"
        />
        <span
          className="absolute inset-1 rounded-full border border-primary/20 animate-pulse"
          aria-hidden="true"
        />
        <span className="material-symbols-outlined relative text-[22px]">
          {phase === "listening" ? "mic" : "auto_awesome"}
        </span>
      </button>

      <div className="min-w-0 flex-1 pr-1">
        <p className="truncate text-sm font-semibold text-text-main">
          {statusLabel}
        </p>
        {hintText ? (
          <p className="truncate text-xs text-text-secondary">{hintText}</p>
        ) : (
          <p className="text-xs text-text-secondary/80">
            Tap away or press Esc to cancel
          </p>
        )}
      </div>
    </div>
  );
}
