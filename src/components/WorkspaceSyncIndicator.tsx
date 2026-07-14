"use client";

import { useEffect, useState } from "react";
import { useAppContext } from "@/context/AppContext";

/** Avoid flashing the badge during brief reconnect blips after wake. */
const SHOW_AFTER_MS = 4_000;

export default function WorkspaceSyncIndicator() {
  const { appSettings, workspaceSyncStatus, selectedWorkspaceId } =
    useAppContext();
  const [showBadge, setShowBadge] = useState(false);

  useEffect(() => {
    if (workspaceSyncStatus === "connected") {
      setShowBadge(false);
      return undefined;
    }

    const id = window.setTimeout(() => setShowBadge(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [workspaceSyncStatus]);

  if (
    !selectedWorkspaceId ||
    !appSettings.showOfflineStatus ||
    workspaceSyncStatus === "connected" ||
    !showBadge
  ) {
    return null;
  }

  const isOffline = workspaceSyncStatus === "offline";

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${
        isOffline
          ? "border-amber-500/30 bg-amber-500/10"
          : "border-sky-500/30 bg-sky-500/10"
      }`}
    >
      <span
        className={`size-2 rounded-full ${isOffline ? "bg-amber-400" : "bg-sky-400 animate-pulse"}`}
        aria-hidden
      />
      <span
        className={`text-[11px] font-bold ${isOffline ? "text-amber-300" : "text-sky-300"}`}
      >
        {isOffline ? "Offline" : "Reconnecting…"}
      </span>
    </div>
  );
}
