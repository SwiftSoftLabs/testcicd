"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface CallsSettingsProps {
  workspaceId: string;
  canEdit: boolean;
}

type WhoCanStart = "all_members" | "admins_only";

export function CallsSettings({ workspaceId, canEdit }: CallsSettingsProps) {
  const [whoCanStart, setWhoCanStart] = useState<WhoCanStart>("all_members");
  const [retentionDays, setRetentionDays] = useState(90);
  const [aiDefault, setAiDefault] = useState(true);
  const [noiseCancellationDefault, setNoiseCancellationDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { settings } = await api.workspaces.getCallSettings(workspaceId);
      const s = settings as Record<string, unknown>;
      if (s.who_can_start_calls === "admins_only") {
        setWhoCanStart("admins_only");
      }
      if (typeof s.call_recording_retention_days === "number") {
        setRetentionDays(s.call_recording_retention_days);
      }
      if (typeof s.call_ai_enabled_default === "boolean") {
        setAiDefault(s.call_ai_enabled_default);
      }
      if (typeof s.call_noise_cancellation_default === "boolean") {
        setNoiseCancellationDefault(s.call_noise_cancellation_default);
      }
    } catch {
      /* defaults */
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    setSaved(false);
    try {
      await api.workspaces.patchCallSettings(workspaceId, {
        who_can_start_calls: whoCanStart,
        call_recording_retention_days: retentionDays,
        call_ai_enabled_default: aiDefault,
        call_noise_cancellation_default: noiseCancellationDefault,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="p-6 bg-background-dark border border-border-dark rounded-2xl space-y-4"
      data-tour="calls-settings-card"
    >
      <h5 className="text-sm font-bold text-main flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px]">videocam</span>
        Video calls
      </h5>
      {loading ? (
        <p className="text-xs text-text-secondary">Loading call settings…</p>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">
              Who can start calls
            </span>
            <select
              disabled={!canEdit}
              value={whoCanStart}
              onChange={(e) => setWhoCanStart(e.target.value as WhoCanStart)}
              className="w-full bg-surface-dark border border-border-dark rounded-xl text-sm text-main px-4 py-2.5 outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all_members">All workspace members</option>
              <option value="admins_only">Admins and owner only</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">
              Recording retention (days)
            </span>
            <input
              type="number"
              min={1}
              max={3650}
              disabled={!canEdit}
              value={retentionDays}
              onChange={(e) =>
                setRetentionDays(parseInt(e.target.value, 10) || 90)
              }
              className="w-full bg-surface-dark border border-border-dark rounded-xl text-sm text-main px-4 py-2.5 outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={aiDefault}
              onChange={(e) => setAiDefault(e.target.checked)}
              className="rounded border-border-dark"
            />
            <span className="text-sm text-main">
              Enable AI assistant by default for new calls
            </span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={noiseCancellationDefault}
              onChange={(e) =>
                setNoiseCancellationDefault(e.target.checked)
              }
              className="rounded border-border-dark"
            />
            <span className="text-sm text-main">
              Enable noise cancellation by default for new calls
            </span>
          </label>
          {canEdit && (
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="cursor-pointer px-4 py-2 bg-primary text-white rounded-xl text-sm font-bold disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save call settings"}
              </button>
              {saved && (
                <span className="text-xs text-emerald-400 font-bold">
                  Saved
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
