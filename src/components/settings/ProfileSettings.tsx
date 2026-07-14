"use client";

import React, { useState, useEffect } from "react";
import { useUIContext } from "@/context/UIContext";
import { useAppContext } from "@/context/AppContext";
import { presenceFromMemberStatus, PRESENCE_DND_LABEL } from "@/lib/presence";
import PresenceDot from "@/components/PresenceDot";

const PRESENCE_OPTIONS: { id: "online" | "away" | "offline"; label: string }[] =
  [
    { id: "online", label: "Online" },
    { id: "away", label: "Away" },
    { id: "offline", label: PRESENCE_DND_LABEL },
  ];

const PRESENCE_TOAST_LABEL: Record<"online" | "away" | "offline", string> = {
  online: "online",
  away: "away",
  offline: "do not disturb",
};

const PREFERENCE_SETTINGS: Array<{
  id: "developerMode" | "showOfflineStatus" | "quickTaskbarPinned";
  label: string;
  desc: string;
}> = [
  {
    id: "developerMode",
    label: "Developer Mode",
    desc: "Show advanced commit metrics and internal tools.",
  },
  {
    id: "showOfflineStatus",
    label: "Show Offline Status",
    desc: "Display an indicator when your workspace isn't syncing in real-time.",
  },
  {
    id: "quickTaskbarPinned",
    label: "Keep Quick Taskbar Pinned",
    desc: "Keep the quick taskbar visible instead of revealing it from the bottom edge.",
  },
];

const ProfileSettings = () => {
  const {
    currentUser,
    appSettings,
    updateAppSettings,
    saveSettingsToDb,
    setWorkspacePresence,
    selectedWorkspace,
    selectedWorkspaceId,
    users,
  } = useAppContext();
  const { addToast } = useUIContext();
  const hasWorkspace = Boolean(selectedWorkspaceId);
  const workspaceLabel = selectedWorkspace?.name ?? "this workspace";

  const [presence, setPresence] = useState<"online" | "away" | "offline">(
    (currentUser.status as "online" | "away" | "offline") || "online",
  );
  const [isUpdatingPresence, setIsUpdatingPresence] = useState(false);
  const [localSettings, setLocalSettings] = useState({ ...appSettings });

  useEffect(() => {
    const currentWorkspaceUser = users.find(
      (user) => user.id === currentUser.id,
    );
    const mappedWorkspaceStatus = currentWorkspaceUser?.status
      ? presenceFromMemberStatus(currentWorkspaceUser.status)
      : (currentUser.status as "online" | "away" | "offline");
    const workspaceStatus =
      mappedWorkspaceStatus === "invited" ? "offline" : mappedWorkspaceStatus;
    setPresence(workspaceStatus || "online");
    setLocalSettings({ ...appSettings });
  }, [currentUser, appSettings, users]);

  const handlePresenceChange = async (
    status: "online" | "away" | "offline",
  ) => {
    if (!selectedWorkspaceId) return;
    setIsUpdatingPresence(true);
    setPresence(status);
    try {
      await setWorkspacePresence(status);
      addToast(`Status set to ${PRESENCE_TOAST_LABEL[status]}.`, "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update status";
      addToast(message, "error");
      setPresence(
        (currentUser.status as "online" | "away" | "offline") || "online",
      );
    } finally {
      setIsUpdatingPresence(false);
    }
  };

  const handleToggle = (
    key: "developerMode" | "showOfflineStatus" | "quickTaskbarPinned",
  ) => {
    setLocalSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSavePreferences = async () => {
    updateAppSettings(localSettings);
    try {
      if (saveSettingsToDb) {
        await saveSettingsToDb(localSettings);
      }
      addToast("Preferences saved.", "success");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to save preferences";
      addToast(message, "error");
    }
  };

  const settings = localSettings as Record<string, unknown>;

  return (
    <div className="min-w-0 max-w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm theme-transition">
        <h3 className="text-lg font-bold text-white mb-2">Presence Status</h3>
        <p className="text-sm text-text-secondary mb-6">
          Applies to {workspaceLabel}.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          {PRESENCE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => handlePresenceChange(opt.id)}
              disabled={isUpdatingPresence || !hasWorkspace}
              className={`cursor-pointer flex-1 flex items-center gap-3 px-5 py-4 rounded-xl border-2 transition-all text-left disabled:opacity-60 ${
                presence === opt.id
                  ? "border-primary bg-primary/5"
                  : "border-border-dark bg-background-dark/30 hover:border-white/10"
              }`}
            >
              <PresenceDot status={opt.id} size="md" />
              <span
                className={`text-sm font-bold ${presence === opt.id ? "text-white" : "text-text-secondary"}`}
              >
                {opt.label}
              </span>
              {presence === opt.id && (
                <span className="ml-auto material-symbols-outlined text-primary text-[18px]">
                  {isUpdatingPresence ? "progress_activity" : "check_circle"}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section className="bg-surface-dark border border-border-dark rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm theme-transition">
        <h3 className="text-lg font-bold text-white mb-2">
          Application Preferences
        </h3>
        <p className="text-sm text-text-secondary mb-8">
          Applies to {workspaceLabel}.
        </p>
        <div className="divide-y divide-white/5">
          {PREFERENCE_SETTINGS.map((setting) => {
            const active = Boolean(settings[setting.id]);
            return (
              <div
                key={setting.id}
                className="py-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between first:pt-0 last:pb-0 group"
              >
                <div className="min-w-0 flex flex-1 flex-col gap-0.5">
                  <span className="text-sm font-bold text-white group-hover:text-primary transition-colors">
                    {setting.label}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {setting.desc}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={active}
                  aria-label={setting.label}
                  disabled={!hasWorkspace}
                  onClick={() => handleToggle(setting.id)}
                  className={`cursor-pointer relative h-6 w-11 shrink-0 rounded-full transition-all duration-300 disabled:opacity-60 ${active ? "bg-primary" : "bg-slate-700"}`}
                >
                  <span
                    className={`absolute top-1 size-4 rounded-full bg-white shadow-sm transition-all duration-300 ${active ? "left-6" : "left-1"}`}
                  ></span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end pt-6 mt-2 border-t border-white/5">
          <button
            onClick={handleSavePreferences}
            disabled={!hasWorkspace}
            className="cursor-pointer px-6 py-2.5 bg-primary text-white text-sm font-black rounded-xl shadow-lg shadow-primary/30 hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-60"
          >
            Save Preferences
          </button>
        </div>
      </section>
    </div>
  );
};

export default ProfileSettings;
