"use client";

import {
  PRESENCE_TAB_HEARTBEAT_MS,
  pickPresenceLeaderTabId,
  presenceTabChannelName,
  pruneStaleTabs,
  readTabRegistry,
  resolveAggregatePresenceStatus,
  writeTabRegistry,
  type PresenceTabMessage,
  type TabPresenceRecord,
} from "@/lib/presence/tab-coordinator";
import type { AutoPresenceStatus } from "@/lib/presence/constants";

export interface PresenceTabCoordinator {
  markActivity: () => void;
  markVisible: () => void;
  markHidden: () => void;
  /** Refresh registry heartbeat without counting as user activity. */
  refresh: () => void;
  destroy: () => void;
}

interface CoordinatorOptions {
  userId: string;
  onLeaderStatus: (status: AutoPresenceStatus, force?: boolean) => void;
  onLastTabClosed: () => void;
  getIsManual: () => boolean;
}

function createTabId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createPresenceTabCoordinator(
  options: CoordinatorOptions,
): PresenceTabCoordinator {
  const { userId, onLeaderStatus, onLastTabClosed, getIsManual } = options;
  const tabId = createTabId();
  let visible = typeof document !== "undefined" ? !document.hidden : true;
  let lastActivityAt = Date.now();
  let destroyed = false;
  let lastPublishedStatus: AutoPresenceStatus | null = null;

  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(presenceTabChannelName(userId))
      : null;

  const selfRecord = (): TabPresenceRecord => ({
    tabId,
    visible,
    lastActivityAt,
    heartbeatAt: Date.now(),
  });

  const upsertSelf = (): TabPresenceRecord[] => {
    const now = Date.now();
    const registry = pruneStaleTabs(readTabRegistry(userId), now);
    registry[tabId] = selfRecord();
    writeTabRegistry(userId, registry);
    return Object.values(registry);
  };

  const removeSelf = (): TabPresenceRecord[] => {
    const registry = readTabRegistry(userId);
    delete registry[tabId];
    writeTabRegistry(userId, registry);
    return Object.values(registry);
  };

  const publishIfLeader = (tabs: TabPresenceRecord[], force = false) => {
    if (destroyed || getIsManual()) return;

    const leaderId = pickPresenceLeaderTabId(tabs);
    if (leaderId !== tabId) return;

    const status = resolveAggregatePresenceStatus(tabs, Date.now());
    if (!force && status === lastPublishedStatus) return;
    lastPublishedStatus = status;
    onLeaderStatus(status, force);
  };

  const broadcast = (message: PresenceTabMessage) => {
    channel?.postMessage(message);
  };

  const sync = (force = false) => {
    if (destroyed) return;
    const record = selfRecord();
    const tabs = upsertSelf();
    broadcast({ type: "sync", tab: record });
    publishIfLeader(tabs, force);
  };

  const onChannelMessage = (event: MessageEvent<PresenceTabMessage>) => {
    if (destroyed) return;
    const message = event.data;
    if (!message || typeof message !== "object") return;

    const now = Date.now();
    const registry = pruneStaleTabs(readTabRegistry(userId), now);

    if (message.type === "close") {
      delete registry[message.tabId];
    } else if (message.type === "sync") {
      registry[message.tab.tabId] = message.tab;
    } else {
      return;
    }

    writeTabRegistry(userId, registry);
    publishIfLeader(Object.values(registry));
  };

  channel?.addEventListener("message", onChannelMessage);

  const heartbeatTimer = window.setInterval(sync, PRESENCE_TAB_HEARTBEAT_MS);

  const onPageHide = () => {
    if (destroyed || getIsManual()) return;

    broadcast({ type: "close", tabId });
    const remaining = removeSelf();

    if (remaining.length === 0) {
      onLastTabClosed();
      return;
    }

    publishIfLeader(remaining);
  };

  window.addEventListener("pagehide", onPageHide);

  sync();

  return {
    markActivity: () => {
      if (destroyed || getIsManual()) return;
      lastActivityAt = Date.now();
      sync();
    },
    markVisible: () => {
      if (destroyed || getIsManual()) return;
      visible = true;
      lastActivityAt = Date.now();
      sync();
    },
    markHidden: () => {
      if (destroyed || getIsManual()) return;
      visible = false;
      sync();
    },
    refresh: () => {
      if (destroyed || getIsManual()) return;
      sync(true);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      window.clearInterval(heartbeatTimer);
      window.removeEventListener("pagehide", onPageHide);
      channel?.removeEventListener("message", onChannelMessage);
      channel?.close();
      broadcast({ type: "close", tabId });
      removeSelf();
    },
  };
}
