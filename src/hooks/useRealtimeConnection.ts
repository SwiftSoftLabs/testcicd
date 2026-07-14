"use client";

import { useEffect, useRef } from "react";
import { ensureFreshAccessToken, runSessionKeepAliveTick } from "@/lib/auth/client-session";
import { insforgeNative } from "@/lib/insforge/native";

export type WorkspaceSyncStatus = "connected" | "reconnecting" | "offline";

const RECONNECT_BACKOFF_MS = [2_000, 5_000, 15_000, 30_000] as const;

/**
 * Keeps InsForge realtime connected (including while the tab is hidden).
 * On disconnect: exponential backoff reconnect. UI "offline" only when the
 * browser reports no network; otherwise shows "reconnecting" while retrying.
 */
export function useRealtimeConnection(
  enabled: boolean,
  onStatusChange: (status: WorkspaceSyncStatus) => void,
) {
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectingRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connectNow = async (resetBackoff: boolean) => {
      if (!window.navigator.onLine) {
        onStatusChange("offline");
        return;
      }
      if (insforgeNative.realtime.isConnected) {
        if (resetBackoff) attemptRef.current = 0;
        onStatusChange("connected");
        return;
      }
      if (reconnectingRef.current) return;

      reconnectingRef.current = true;
      onStatusChange("reconnecting");

      try {
        await ensureFreshAccessToken();
        await insforgeNative.realtime.connect();
        attemptRef.current = 0;
        onStatusChange("connected");
      } catch {
        if (!window.navigator.onLine) {
          onStatusChange("offline");
        } else {
          onStatusChange("reconnecting");
          scheduleReconnect();
        }
      } finally {
        reconnectingRef.current = false;
      }
    };

    const scheduleReconnect = () => {
      clearReconnectTimer();
      if (!window.navigator.onLine) {
        onStatusChange("offline");
        return;
      }

      onStatusChange("reconnecting");
      const delay =
        RECONNECT_BACKOFF_MS[
          Math.min(attemptRef.current, RECONNECT_BACKOFF_MS.length - 1)
        ];
      attemptRef.current += 1;

      reconnectTimerRef.current = setTimeout(() => {
        void connectNow(false);
      }, delay);
    };

    const onConnect = () => {
      attemptRef.current = 0;
      clearReconnectTimer();
      onStatusChange("connected");
    };

    const onDisconnect = () => {
      if (!window.navigator.onLine) {
        onStatusChange("offline");
        return;
      }
      scheduleReconnect();
    };

    const onBrowserOnline = () => {
      attemptRef.current = 0;
      void connectNow(true);
    };

    const onBrowserOffline = () => {
      clearReconnectTimer();
      onStatusChange("offline");
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void runSessionKeepAliveTick();
      if (!insforgeNative.realtime.isConnected && window.navigator.onLine) {
        attemptRef.current = 0;
        void connectNow(true);
      }
    };

    insforgeNative.realtime.on("connect", onConnect);
    insforgeNative.realtime.on("disconnect", onDisconnect);
    window.addEventListener("online", onBrowserOnline);
    window.addEventListener("offline", onBrowserOffline);
    document.addEventListener("visibilitychange", onVisibility);

    if (window.navigator.onLine) {
      void connectNow(true);
    } else {
      onStatusChange("offline");
    }

    return () => {
      clearReconnectTimer();
      insforgeNative.realtime.off("connect", onConnect);
      insforgeNative.realtime.off("disconnect", onDisconnect);
      window.removeEventListener("online", onBrowserOnline);
      window.removeEventListener("offline", onBrowserOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, onStatusChange]);
}
