"use client";

import React from "react";
import { ViewMode } from "@/types/files";

interface ViewModeToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const MODES: { value: ViewMode; icon: string; label: string }[] = [
  { value: "list", icon: "view_list", label: "List view" },
  { value: "icon", icon: "grid_view", label: "Icon view" },
  { value: "details", icon: "table_chart", label: "Details view" },
];

export function ViewModeToggle({ mode, onChange }: ViewModeToggleProps) {
  return (
    <div className="flex rounded-lg border border-border overflow-hidden">
      {MODES.map(({ value, icon, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          title={label}
          className={`cursor-pointer px-2.5 py-1.5 transition-colors ${
            mode === value
              ? "bg-bg-hover text-text-primary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-hover/50"
          }`}
        >
          <span className="material-symbols-outlined text-base leading-none">
            {icon}
          </span>
        </button>
      ))}
    </div>
  );
}
