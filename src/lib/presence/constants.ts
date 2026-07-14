/** Heartbeat interval while tab is visible and active. */
export const PRESENCE_HEARTBEAT_MS = 60_000;

/** No mouse/keyboard activity → Away (Slack default). */
export const PRESENCE_IDLE_AWAY_MS = 10 * 60_000;

/** Throttle activity listeners to avoid excessive PATCH calls. */
export const PRESENCE_ACTIVITY_THROTTLE_MS = 30_000;

/** Server-side: no heartbeat this long → display Away when stored status is online. */
export const PRESENCE_STALE_AWAY_SECONDS = 180;

/** Server-side: no heartbeat this long → display Offline. */
export const PRESENCE_STALE_OFFLINE_SECONDS = 900;

export type AutoPresenceStatus = "online" | "away" | "offline";
