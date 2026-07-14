import {
  PRESENCE_IDLE_AWAY_MS,
  type AutoPresenceStatus,
} from "@/lib/presence/constants";

export const PRESENCE_TAB_REGISTRY_KEY_PREFIX = "ow-presence-tabs:";
export const PRESENCE_TAB_CHANNEL_PREFIX = "ow-presence:";

/** Tab dropped from registry when heartbeat is older than this. */
export const PRESENCE_TAB_STALE_MS = 45_000;

/** How often each tab refreshes its registry entry. */
export const PRESENCE_TAB_HEARTBEAT_MS = 15_000;

export interface TabPresenceRecord {
  tabId: string;
  visible: boolean;
  lastActivityAt: number;
  heartbeatAt: number;
}

export type PresenceTabMessage =
  | { type: "sync"; tab: TabPresenceRecord }
  | { type: "close"; tabId: string };

export function presenceTabRegistryKey(userId: string): string {
  return `${PRESENCE_TAB_REGISTRY_KEY_PREFIX}${userId}`;
}

export function presenceTabChannelName(userId: string): string {
  return `${PRESENCE_TAB_CHANNEL_PREFIX}${userId}`;
}

export function resolveAggregatePresenceStatus(
  tabs: TabPresenceRecord[],
  now: number,
  idleAwayMs = PRESENCE_IDLE_AWAY_MS,
): AutoPresenceStatus {
  if (tabs.length === 0) return "offline";

  const anyVisible = tabs.some((tab) => tab.visible);
  if (!anyVisible) return "away";

  const latestActivity = Math.max(...tabs.map((tab) => tab.lastActivityAt));
  if (now - latestActivity >= idleAwayMs) return "away";

  return "online";
}

/** Visible tab with latest activity wins; otherwise any tab with latest heartbeat. */
export function pickPresenceLeaderTabId(
  tabs: TabPresenceRecord[],
): string | null {
  if (tabs.length === 0) return null;

  const visible = tabs.filter((tab) => tab.visible);
  const pool = visible.length > 0 ? visible : tabs;

  const sorted = [...pool].sort((a, b) => {
    const activityDiff = b.lastActivityAt - a.lastActivityAt;
    if (activityDiff !== 0) return activityDiff;
    return a.tabId.localeCompare(b.tabId);
  });

  return sorted[0]?.tabId ?? null;
}

export function pruneStaleTabs(
  tabs: Record<string, TabPresenceRecord>,
  now: number,
  staleMs = PRESENCE_TAB_STALE_MS,
): Record<string, TabPresenceRecord> {
  const next: Record<string, TabPresenceRecord> = {};
  for (const [tabId, tab] of Object.entries(tabs)) {
    if (now - tab.heartbeatAt <= staleMs) {
      next[tabId] = tab;
    }
  }
  return next;
}

export function readTabRegistry(
  userId: string,
): Record<string, TabPresenceRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(presenceTabRegistryKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TabPresenceRecord>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function writeTabRegistry(
  userId: string,
  tabs: Record<string, TabPresenceRecord>,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(presenceTabRegistryKey(userId), JSON.stringify(tabs));
  } catch {
    // Ignore quota / private mode errors.
  }
}
