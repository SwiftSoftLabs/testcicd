"use client";

import React, { useCallback, useEffect, useState } from "react";

import { useUIContext } from "@/context/UIContext";
import { api } from "@/lib/api";
import type { BranchProtectionRule } from "@/lib/integrations/git/branch-protection";

type BranchProtectionPanelProps = {
  workspaceId: string;
  projectId: string;
  readOnly?: boolean;
};

const emptyRule = (): Omit<BranchProtectionRule, "id" | "created_at"> => ({
  project_id: "",
  branch_pattern: "main",
  require_approval_count: 1,
  require_status_checks: false,
  required_check_names: [],
  block_force_push: true,
  allow_admin_bypass: false,
});

export default function BranchProtectionPanel({
  workspaceId,
  projectId,
  readOnly = false,
}: BranchProtectionPanelProps) {
  const { addToast } = useUIContext();
  const [rules, setRules] = useState<
    Omit<BranchProtectionRule, "id" | "created_at">[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId || !projectId) return;
    setLoading(true);
    try {
      const rows = await api.integrations.git.branchProtection.list(
        workspaceId,
        projectId,
      );
      setRules(
        rows.length > 0
          ? rows.map((r) => ({
              project_id: r.project_id,
              branch_pattern: r.branch_pattern,
              require_approval_count: r.require_approval_count,
              require_status_checks: r.require_status_checks,
              required_check_names: r.required_check_names,
              block_force_push: r.block_force_push,
              allow_admin_bypass: r.allow_admin_bypass,
            }))
          : [emptyRule()],
      );
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to load branch protection",
        "error",
      );
      setRules([emptyRule()]);
    } finally {
      setLoading(false);
    }
  }, [addToast, projectId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateRule = (
    index: number,
    patch: Partial<Omit<BranchProtectionRule, "id" | "created_at">>,
  ) => {
    setRules((prev) =>
      prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  };

  const save = async () => {
    if (readOnly) return;
    setSaving(true);
    try {
      const saved = await api.integrations.git.branchProtection.save(
        workspaceId,
        projectId,
        rules,
      );
      setRules(
        saved.map((r) => ({
          project_id: r.project_id,
          branch_pattern: r.branch_pattern,
          require_approval_count: r.require_approval_count,
          require_status_checks: r.require_status_checks,
          required_check_names: r.required_check_names,
          block_force_push: r.block_force_push,
          allow_admin_bypass: r.allow_admin_bypass,
        })),
      );
      addToast("Branch protection saved.", "success");
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : "Failed to save branch protection",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="text-sm text-text-secondary italic">
        Loading branch protection…
      </p>
    );
  }

  return (
    <div className="max-w-3xl space-y-4 rounded-xl border border-border-dark bg-surface-dark/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-main">Branch protection</h4>
          <p className="text-xs text-text-secondary mt-1">
            Enforce approvals and required checks before merging into protected
            branches.
          </p>
        </div>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => setRules((prev) => [...prev, emptyRule()])}
            className="cursor-pointer h-8 px-3 rounded-lg border border-border-dark text-xs font-bold text-main hover:bg-white/5"
          >
            Add rule
          </button>
        ) : null}
      </div>

      {rules.map((rule, index) => (
        <div
          key={`rule-${index}`}
          className="rounded-lg border border-border-dark bg-background-dark/40 p-4 space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                Branch pattern
              </span>
              <input
                type="text"
                value={rule.branch_pattern}
                disabled={readOnly}
                onChange={(e) =>
                  updateRule(index, { branch_pattern: e.target.value })
                }
                className="w-full h-9 px-3 rounded-lg bg-background-dark border border-border-dark text-sm text-main"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                Required approvals
              </span>
              <input
                type="number"
                min={0}
                max={20}
                value={rule.require_approval_count}
                disabled={readOnly}
                onChange={(e) =>
                  updateRule(index, {
                    require_approval_count: Number(e.target.value) || 0,
                  })
                }
                className="w-full h-9 px-3 rounded-lg bg-background-dark border border-border-dark text-sm text-main"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={rule.require_status_checks}
              disabled={readOnly}
              onChange={(e) =>
                updateRule(index, { require_status_checks: e.target.checked })
              }
              className="rounded border-border-dark"
            />
            Require status checks to pass
          </label>

          {rule.require_status_checks ? (
            <label className="space-y-1 block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                Required check names (comma-separated)
              </span>
              <input
                type="text"
                value={rule.required_check_names.join(", ")}
                disabled={readOnly}
                onChange={(e) =>
                  updateRule(index, {
                    required_check_names: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="ci, lint, test"
                className="w-full h-9 px-3 rounded-lg bg-background-dark border border-border-dark text-sm text-main"
              />
            </label>
          ) : null}

          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={rule.allow_admin_bypass}
              disabled={readOnly}
              onChange={(e) =>
                updateRule(index, { allow_admin_bypass: e.target.checked })
              }
              className="rounded border-border-dark"
            />
            Allow workspace admins to bypass
          </label>
        </div>
      ))}

      {!readOnly ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="cursor-pointer h-9 px-4 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save protection rules"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
