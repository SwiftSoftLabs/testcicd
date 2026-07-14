"use client";

import React, { useMemo } from "react";

import type { GitBranchInfo } from "@/types/git";

type BranchPickerProps = {
  branches: GitBranchInfo[];
  currentBranch: string;
  onChange: (name: string) => void;
  show: boolean;
  onToggle: () => void;
  onToast: (msg: string, variant: "success" | "info") => void;
  disabled?: boolean;
};

export default function BranchPicker({
  branches,
  currentBranch,
  onChange,
  show,
  onToggle,
  onToast,
  disabled = false,
}: BranchPickerProps) {
  const sorted = useMemo(
    () =>
      [...branches].sort((a, b) =>
        a.isDefault === b.isDefault
          ? a.name.localeCompare(b.name)
          : a.isDefault
            ? -1
            : 1,
      ),
    [branches],
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && onToggle()}
        disabled={disabled}
        className="flex h-10 min-h-10 items-center gap-2 px-3 rounded-lg bg-background-dark border border-border-dark text-xs font-bold text-main hover:border-white/20 transition-all uppercase tracking-tight disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border-dark"
      >
        <span className="material-symbols-outlined text-[18px] text-primary shrink-0">
          call_split
        </span>
        <span className="truncate max-w-[120px]">{currentBranch}</span>
        <span className="material-symbols-outlined text-[18px] text-text-secondary shrink-0">
          expand_more
        </span>
      </button>
      {show && !disabled && (
        <div className="absolute top-full left-0 mt-2 w-56 bg-surface-dark border border-border-dark rounded-xl shadow-2xl z-50 p-1.5 animate-in fade-in zoom-in-95 duration-200">
          <p className="px-3 py-2 text-[10px] font-bold text-text-secondary uppercase tracking-widest border-b border-white/5 mb-1">
            Select Branch
          </p>
          {sorted.map((b) => (
            <button
              key={b.name}
              type="button"
              onClick={() => {
                onChange(b.name);
                onToast(`Switched to branch: ${b.name}`, "success");
                onToggle();
              }}
              className={`cursor-pointer w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${b.name === currentBranch ? "bg-primary/20 text-primary" : "text-text-secondary hover:bg-white/5 hover:text-main"}`}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
