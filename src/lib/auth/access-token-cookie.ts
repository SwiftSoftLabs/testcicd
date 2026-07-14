/** Fallback when JWT `exp` is missing. Match InsForge access JWT lifetime if known. */
export const ACCESS_TOKEN_JWT_TTL_SECONDS = 10800;

/** Refresh this many seconds before JWT `exp` (~8 min for typical 15m tokens). */
export const PROACTIVE_REFRESH_BEFORE_EXPIRY_SECONDS = 480;

/** Background JWT check while the app is open (local check; refresh only when needed). */
export const SESSION_KEEPALIVE_INTERVAL_MS = 3 * 60 * 1000;

/** Minimum gap between InsForge auth refresh attempts (anti-hammer). */
export const MIN_REFRESH_INTERVAL_MS = 90 * 1000;

/** Shorter gap when the access JWT is already expired (still capped). */
export const URGENT_REFRESH_INTERVAL_MS = 30 * 1000;

/** Debounce tab-wake refresh so multiple handlers do not stack. */
export const SESSION_WAKE_DEBOUNCE_MS = 5 * 1000;

/** Backoff for silent auth recovery after 401 (no logout). */
export const AUTH_RECOVERY_INITIAL_BACKOFF_MS = 30 * 1000;
export const AUTH_RECOVERY_MAX_BACKOFF_MS = 5 * 60 * 1000;

/** Fast retries for user-initiated requests / tab wake after standby (not background polls). */
export const USER_REQUEST_MAX_REFRESH_ATTEMPTS = 3;
export const USER_REQUEST_RETRY_MS = [400, 1200] as const;

/** Lighter retries for call-room polling (avoids hammering on 12s intervals). */
export const CALL_API_MAX_REFRESH_ATTEMPTS = 2;

/**
 * Browser cookie max-age for `sb-access-token` and `ow-session`.
 * Long-lived so standby / reboot does not drop the session shell before the
 * client can refresh the JWT (actual token rotation stays on JWT expiry).
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** @deprecated Use SESSION_COOKIE_MAX_AGE_SECONDS for cookie max-age. */
export const ACCESS_TOKEN_COOKIE_MAX_AGE_SECONDS = SESSION_COOKIE_MAX_AGE_SECONDS;

export const SESSION_HINT_COOKIE = "ow-session";

/** httpOnly refresh token on app origin — survives localStorage loss after standby. */
export const OW_REFRESH_TOKEN_COOKIE = "ow-refresh-token";

/** Stable localStorage session key (hostname-independent). */
export const OW_AUTH_SESSION_STORAGE_KEY = "ow-auth-session";

/** Set on explicit user sign-out; blocks silent session restore until next login. */
export const OW_MANUAL_SIGNOUT_STORAGE_KEY = "ow-manual-signout";

export const SESSION_AUTH_DEGRADED_EVENT = "ow:session-auth-degraded";
export const SESSION_AUTH_RECOVERED_EVENT = "ow:session-auth-recovered";
