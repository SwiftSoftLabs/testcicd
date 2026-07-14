"use client";

import React, { useState } from "react";

import type { GitBranchInfo } from "@/types/git";

type RepoBranchesProps = {
  branches: GitBranchInfo[];
  currentBranch: string;
  onSwitch: (name: string) => void;
  readOnly?: boolean;
  allowCreate?: boolean;
  onCreateBranch?: (name: string, fromRef: string) => Promise<void>;
};

export default function RepoBranches({
  branches,
  currentBranch,
  onSwitch,
  readOnly = false,
  allowCreate = false,
  onCreateBranch,
}: RepoBranchesProps) {
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [fromRef, setFromRef] = useState(currentBranch);
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!onCreateBranch || !newName.trim()) return;
    setSaving(true);
    try {
      await onCreateBranch(newName.trim(), fromRef || currentBranch);
      setNewName("");
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-4 animate-in fade-in duration-300">
      <div className="flex justify-between items-center mb-6 gap-3">
        <h3 className="text-lg font-bold text-main">Active Branches</h3>
        {allowCreate && onCreateBranch && !readOnly && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="h-8 px-3 rounded-lg bg-primary text-white text-xs font-bold"
          >
            New branch
          </button>
        )}
      </div>
      {showForm && allowCreate && (
        <div className="bg-surface-dark border border-border-dark rounded-xl p-4 space-y-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="branch-name"
            className="w-full h-9 px-3 rounded-lg bg-background-dark border border-border-dark text-sm text-main"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary shrink-0">From</span>
            <select
              value={fromRef}
              onChange={(e) => setFromRef(e.target.value)}
              className="flex-1 h-9 px-2 rounded-lg bg-background-dark border border-border-dark text-sm text-main"
            >
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="h-8 px-3 rounded-lg border border-border-dark text-xs font-bold text-main"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !newName.trim()}
              onClick={() => void handleCreate()}
              className="h-8 px-3 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}
      {branches.map((branch) => (
        <div
          key={branch.name}
          className="bg-surface-dark border border-border-dark rounded-xl p-4 flex items-center justify-between hover:bg-white/[0.02] transition-all"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="material-symbols-outlined text-text-secondary shrink-0">
              call_split
            </span>
            <span className="text-sm font-bold text-main truncate">
              {branch.name}
            </span>
            {branch.isDefault && (
              <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded font-black uppercase tracking-tighter shrink-0">
                Default
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!readOnly) onSwitch(branch.name);
            }}
            disabled={readOnly}
            className="px-3 py-1 bg-surface-highlight border border-border-dark rounded-md text-[10px] font-bold text-main hover:bg-white/10 shrink-0 ml-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface-highlight"
          >
            Switch
          </button>
        </div>
      ))}
      {branches.length === 0 && (
        <div className="py-20 text-center text-text-secondary italic text-sm">
          No branches found.
        </div>
      )}
    </div>
  );
}
