"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { createPresenceTabCoordinator } from "@/lib/presence/create-presence-tab-coordinator";
import {
  PRESENCE_ACTIVITY_THROTTLE_MS,
  PRESENCE_HEARTBEAT_MS,
} from "@/lib/presence/constants";
import type { AutoPresenceStatus } from "@/lib/presence/constants";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ManualPresenceGuard = () => boolean;

/**
 * Slack-like presence while the app is open (multi-tab aware).
 *
 * - Active (online): any tab visible + recent activity across tabs
 * - Away: all tabs hidden, or 10 min idle across tabs
 * - Offline: last tab closed (beacon) or logout
 * - Manual Away / DND: auto updates skipped when guard returns true
 */
export function usePresence(
  userId: string,
  getIsManualPresence?: ManualPresenceGuard,
) {
  const getIsManualPresenceRef = useRef(getIsManualPresence);
  getIsManualPresenceRef.current = getIsManualPresence;

  useEffect(() => {
    if (!UUID_RE.test(userId)) return;

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let lastThrottledActivityAt = 0;
    let lastSentStatus: AutoPresenceStatus | null = null;

    const isManual = () => getIsManualPresenceRef.current?.() ?? false;

    const sendAutoPresence = (status: AutoPresenceStatus, force = false) => {
      if (isManual()) return;
      if (!force && lastSentStatus === status) return;
      lastSentStatus = status;
      api.profile.updatePresence(status, null, false).catch(() => {
        lastSentStatus = null;
      });
    };

    const coordinator = createPresenceTabCoordinator({
      userId,
      getIsManual: isManual,
      onLeaderStatus: (status, force = false) => {
        sendAutoPresence(status, force);
      },
      onLastTabClosed: () => {
        if (isManual()) return;
        api.profile.beaconOffline();
      },
    });

    const onActivity = () => {
      if (isManual()) return;

      const now = Date.now();
      if (now - lastThrottledActivityAt < PRESENCE_ACTIVITY_THROTTLE_MS) {
        coordinator.markActivity();
        return;
      }

      lastThrottledActivityAt = now;
      coordinator.markActivity();
    };

    const onVisibility = () => {
      if (isManual()) return;

      if (document.hidden) {
        coordinator.markHidden();
        return;
      }

      coordinator.markVisible();
    };

    coordinator.markVisible();

    heartbeatTimer = setInterval(() => {
      if (isManual()) return;
      coordinator.refresh();
    }, PRESENCE_HEARTBEAT_MS);

    const activityEvents = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart",
    ] as const;

    for (const event of activityEvents) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      for (const event of activityEvents) {
        window.removeEventListener(event, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      coordinator.destroy();
    };
  }, [userId]);
}
