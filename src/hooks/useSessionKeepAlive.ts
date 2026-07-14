"use client";

import { useEffect } from "react";
import { SESSION_KEEPALIVE_INTERVAL_MS } from "@/lib/auth/access-token-cookie";
import {
  refreshSessionOnWake,
  runSessionKeepAliveTick,
  subscribeCriticalSession,
} from "@/lib/auth/client-session";

type KeepAliveMode = "app" | "critical";

/**
 * Keeps the InsForge access JWT fresh while enabled.
 * Checks locally on an interval; refreshes only when the JWT is near expiry.
 * Critical mode (active call) registers critical session — never auto-logout.
 */
export function useSessionKeepAlive(
  enabled: boolean,
  mode: KeepAliveMode = "app",
): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    const critical = mode === "critical";

    const tick = () => {
      void runSessionKeepAliveTick();
    };

    void tick();

    const id = window.setInterval(tick, SESSION_KEEPALIVE_INTERVAL_MS);

    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      void refreshSessionOnWake();
    };

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onWake);

    const unsubCritical = critical ? subscribeCriticalSession() : undefined;

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onWake);
      unsubCritical?.();
    };
  }, [enabled, mode]);
}
