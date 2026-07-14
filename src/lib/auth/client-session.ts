import { insforgeNative } from "@/lib/insforge/native";
import {
  markInsforgeRateLimited,
  isInsforgeRateLimited,
} from "@/lib/insforgeRateLimit";
import {
  ACCESS_TOKEN_JWT_TTL_SECONDS,
  AUTH_RECOVERY_INITIAL_BACKOFF_MS,
  AUTH_RECOVERY_MAX_BACKOFF_MS,
  CALL_API_MAX_REFRESH_ATTEMPTS,
  MIN_REFRESH_INTERVAL_MS,
  PROACTIVE_REFRESH_BEFORE_EXPIRY_SECONDS,
  SESSION_AUTH_DEGRADED_EVENT,
  SESSION_AUTH_RECOVERED_EVENT,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_HINT_COOKIE,
  SESSION_WAKE_DEBOUNCE_MS,
  OW_AUTH_SESSION_STORAGE_KEY,
  OW_MANUAL_SIGNOUT_STORAGE_KEY,
  URGENT_REFRESH_INTERVAL_MS,
  USER_REQUEST_MAX_REFRESH_ATTEMPTS,
  USER_REQUEST_RETRY_MS,
} from "@/lib/auth/access-token-cookie";

type PersistedShape = {
  access_token: string;
  refresh_token: string;
  user: unknown;
  expires_at: number;
};

/** Dispatched only on explicit user sign-out (not auto-logout). */
export const SESSION_EXPIRED_EVENT = "ow:session-expired";

function authStorageKey(): string {
  return OW_AUTH_SESSION_STORAGE_KEY;
}

function legacyAuthStorageKeys(): string[] {
  if (typeof window === "undefined") return [];
  const keys: string[] = [];
  if (typeof window.location?.hostname === "string") {
    keys.push(`sb-${window.location.hostname}-auth-token`);
  }
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && /^sb-.*-auth-token$/.test(k) && !keys.includes(k)) {
      keys.push(k);
    }
  }
  return keys;
}

function parsePersistedRaw(raw: string | null): PersistedShape | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<PersistedShape>;
    if (
      typeof o.access_token !== "string" ||
      typeof o.refresh_token !== "string"
    ) {
      return null;
    }
    const expires_at =
      typeof o.expires_at === "number"
        ? o.expires_at
        : (jwtExpSeconds(o.access_token) ??
          Math.floor(Date.now() / 1000) + ACCESS_TOKEN_JWT_TTL_SECONDS);
    return {
      access_token: o.access_token,
      refresh_token: o.refresh_token,
      user: o.user ?? null,
      expires_at,
    };
  } catch {
    return null;
  }
}

function jwtExpSeconds(accessToken: string): number | null {
  try {
    const part = accessToken.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function readCookieAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const part = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith("sb-access-token="));
  if (!part) return null;
  return decodeURIComponent(part.split("=").slice(1).join("=").trim());
}

export function isAccessTokenExpired(
  accessToken: string,
  skewSeconds = 0,
): boolean {
  const exp = jwtExpSeconds(accessToken);
  if (!exp) return true;
  return exp <= Math.floor(Date.now() / 1000) + skewSeconds;
}

export function isUnauthorizedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg === "unauthorized" || msg.includes("401");
}

export function readPersistedSession(): PersistedShape | null {
  if (typeof window === "undefined") return null;

  const primary = parsePersistedRaw(localStorage.getItem(authStorageKey()));
  if (primary) return primary;

  for (const key of legacyAuthStorageKeys()) {
    const legacy = parsePersistedRaw(localStorage.getItem(key));
    if (legacy) {
      localStorage.setItem(authStorageKey(), JSON.stringify(legacy));
      return legacy;
    }
  }

  return null;
}

export function hasRestorableClientSession(): boolean {
  if (typeof window === "undefined") return false;
  if (isManualSignOutActive()) return false;
  if (readPersistedSession()?.refresh_token) return true;
  if (localStorage.getItem("ow-current-user")) return true;
  return document.cookie.includes(`${SESSION_HINT_COOKIE}=1`);
}

export function isManualSignOutActive(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(OW_MANUAL_SIGNOUT_STORAGE_KEY) === "1";
}

export function markManualSignOutActive(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(OW_MANUAL_SIGNOUT_STORAGE_KEY, "1");
}

export function clearManualSignOutMarker(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(OW_MANUAL_SIGNOUT_STORAGE_KEY);
}

export function readNativeSdkAccessToken(): string | null {
  const client = insforgeNative as unknown as {
    tokenManager?: { getAccessToken?: () => string | null };
  };
  return client.tokenManager?.getAccessToken?.() ?? null;
}

export function readNativeSdkRefreshToken(): string | null {
  const http = insforgeNative.getHttpClient() as unknown as {
    refreshToken?: string | null;
  };
  return http.refreshToken ?? null;
}

/** Persist OAuth / native SDK session into app cookies + localStorage. */
export async function persistNativeAuthSession(user: unknown): Promise<boolean> {
  const accessToken = readNativeSdkAccessToken();
  const memoryRefresh = readNativeSdkRefreshToken();

  let accessTokenFinal = accessToken;
  let refreshTokenFinal = memoryRefresh;

  if (!accessTokenFinal) {
    const { data: refreshed } = await insforgeNative.auth
      .refreshSession()
      .catch(() => ({ data: null, error: null }));
    accessTokenFinal = refreshed?.accessToken ?? null;
    refreshTokenFinal =
      refreshed?.refreshToken ?? refreshTokenFinal ?? null;
  }

  if (!accessTokenFinal) {
    return false;
  }

  const refreshToken = refreshTokenFinal ?? accessTokenFinal;

  await persistClientSessionAndSync(accessTokenFinal, refreshToken, user);
  return true;
}

function setSessionCookies(accessToken: string): void {
  document.cookie = `sb-access-token=${encodeURIComponent(accessToken)}; path=/; max-age=${SESSION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  document.cookie = `${SESSION_HINT_COOKIE}=1; path=/; max-age=${SESSION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function clearClientSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("ow-current-user");
  localStorage.removeItem(authStorageKey());
  for (const key of legacyAuthStorageKeys()) {
    localStorage.removeItem(key);
  }
  document.cookie = "sb-access-token=; path=/; max-age=0; SameSite=Lax";
  document.cookie = `${SESSION_HINT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/** Full user-initiated sign-out — blocks silent session recovery until next login. */
export async function performManualSignOut(options?: {
  redirectTo?: string;
}): Promise<void> {
  if (typeof window === "undefined") return;

  markManualSignOutActive();
  stopAuthRecoveryLoop();
  refreshInFlight = null;
  sessionAuthDegraded = false;

  const { createClient } = await import("@/lib/insforge/client");
  await createClient()
    .auth.signOut()
    .catch(() => {});
  await insforgeNative.auth.signOut().catch(() => {});

  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  }).catch(() => {});

  clearClientSession();
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));

  window.location.replace(options?.redirectTo ?? "/login?reason=signed_out");
}

/** Persist Supabase-style session + app cookies (used after login / refresh). */
export async function persistClientSessionAndSync(
  accessToken: string,
  refreshToken: string,
  user: unknown,
): Promise<void> {
  const exp = jwtExpSeconds(accessToken);
  const expires_at =
    exp ?? Math.floor(Date.now() / 1000) + ACCESS_TOKEN_JWT_TTL_SECONDS;
  localStorage.setItem(
    authStorageKey(),
    JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      user,
      expires_at,
    } satisfies PersistedShape),
  );
  for (const key of legacyAuthStorageKeys()) {
    if (key !== authStorageKey()) {
      localStorage.setItem(
        key,
        localStorage.getItem(authStorageKey()) ?? "",
      );
    }
  }
  setSessionCookies(accessToken);
  await fetch("/api/auth/sync-cookie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ accessToken, refreshToken }),
  }).catch(() => {});
}

export function accessTokenExpiresWithinSeconds(seconds: number): boolean {
  const session = readPersistedSession();
  const token = session?.access_token ?? readCookieAccessToken();
  if (!token) return true;
  const exp = jwtExpSeconds(token);
  if (!exp) return true;
  return exp <= Math.floor(Date.now() / 1000) + seconds;
}

function cookieAuthLooksValid(skewSeconds = 90): boolean {
  const cookie = readCookieAccessToken();
  return Boolean(cookie && !isAccessTokenExpired(cookie, skewSeconds));
}

/** Access JWT missing or past exp — needs InsForge refresh (bypasses proactive throttle). */
function accessJwtExpired(): boolean {
  return !cookieAuthLooksValid(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Align sb-access-token cookie with a still-valid access token in localStorage.
 */
export async function syncAccessTokenCookieFromStorage(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const session = readPersistedSession();
  if (!session?.access_token) return false;
  if (isAccessTokenExpired(session.access_token, 30)) return false;

  const cookieToken = readCookieAccessToken();
  const cookieStale =
    !cookieToken ||
    isAccessTokenExpired(cookieToken, 30) ||
    cookieToken !== session.access_token;

  if (!cookieStale) return true;

  setSessionCookies(session.access_token);
  await fetch("/api/auth/sync-cookie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken: session.access_token }),
  }).catch(() => {});
  return true;
}

function readCsrfToken(): string | null {
  if (typeof window === "undefined") return null;
  const part = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith("insforge_csrf_token="));
  if (!part) return null;
  return decodeURIComponent(part.split("=").slice(1).join("=").trim());
}

/** Browser OAuth refresh: POST /api/auth/refresh with { refreshToken } + CSRF. */
async function refreshViaBrowserRefreshTokenProxy(
  refreshToken: string,
  logLabel: string,
): Promise<boolean> {
  const csrf = readCsrfToken();
  if (!csrf) return false;

  const bodies: Record<string, string>[] = [
    { refreshToken },
    { refresh_token: refreshToken },
  ];

  for (const body of bodies) {
    const res = await fetch("/auth/v1/refresh", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      markInsforgeRateLimited();
      return false;
    }

    if (!res.ok) {
      continue;
    }

    const payload = (await res.json().catch(() => null)) as {
      accessToken?: string;
      refreshToken?: string;
      user?: unknown;
    } | null;

    if (!payload?.accessToken) continue;

    const prev = readPersistedSession();
    const nextRt =
      payload.refreshToken ?? prev?.refresh_token ?? payload.accessToken;
    await persistClientSessionAndSync(
      payload.accessToken,
      nextRt,
      payload.user ?? prev?.user ?? null,
    );
    return true;
  }

  return false;
}

/** OAuth/browser tokens use /auth/refresh + refreshToken body; email login uses mobile proxy. */
async function refreshWithStoredToken(
  refreshToken: string,
  logLabel: string,
): Promise<boolean> {
  if (readCsrfToken()) {
    const browserOk = await refreshViaBrowserRefreshTokenProxy(
      refreshToken,
      logLabel,
    );
    if (browserOk) return true;
  }
  return refreshViaMobileProxy(refreshToken, logLabel);
}

/** Mobile refresh via same-origin proxy (requires refresh_token in body). */
async function refreshViaMobileProxy(
  refreshToken: string,
  logLabel: string,
): Promise<boolean> {
  const res = await fetch("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (res.status === 429) {
    markInsforgeRateLimited();
    return false;
  }

  if (!res.ok) {
    return false;
  }

  const payload = (await res.json().catch(() => null)) as {
    accessToken?: string;
    refreshToken?: string;
    user?: unknown;
  } | null;

  if (!payload?.accessToken) return false;

  const prev = readPersistedSession();
  const nextRt =
    payload.refreshToken ?? prev?.refresh_token ?? payload.accessToken;
  await persistClientSessionAndSync(
    payload.accessToken,
    nextRt,
    payload.user ?? prev?.user ?? null,
  );
  return true;
}

/** Last-resort: use expired sb-access-token cookie as mobile refresh_token. */
async function refreshViaCookieAccessTokenFallback(): Promise<boolean> {
  const token = readCookieAccessToken();
  if (!token) return false;
  return refreshViaMobileProxy(token, "refreshViaCookieFallback");
}

/** Browser-mode InsForge refresh via same-origin proxy (CSRF + httpOnly refresh cookie). */
async function refreshViaBrowserCsrfProxy(): Promise<boolean> {
  const csrf = readCsrfToken();
  const res = await fetch("/auth/v1/refresh", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
  });

  if (res.status === 429) {
    markInsforgeRateLimited();
    return false;
  }

  if (!res.ok) {
    return false;
  }

  const payload = (await res.json().catch(() => null)) as {
    accessToken?: string;
    refreshToken?: string;
    user?: unknown;
  } | null;

  if (!payload?.accessToken) return false;

  const prev = readPersistedSession();
  const nextRt =
    payload.refreshToken ?? prev?.refresh_token ?? payload.accessToken;
  await persistClientSessionAndSync(
    payload.accessToken,
    nextRt,
    payload.user ?? prev?.user ?? null,
  );
  return true;
}

/** Same-origin proxy refresh using login-time httpOnly cookies (no localStorage). */
async function refreshViaCredentialsIncludeProxy(): Promise<boolean> {
  const token = readCookieAccessToken();
  if (!token) return false;
  return refreshViaMobileProxy(token, "refreshViaCredentials");
}

/** Refresh via SSR session cookies (OAuth) — same-origin, no localStorage refresh needed. */
async function refreshViaServerSessionRoute(): Promise<boolean> {
  const res = await fetch("/api/auth/refresh-session", {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) {
    return false;
  }

  const payload = (await res.json().catch(() => null)) as {
    accessToken?: string;
    refreshToken?: string;
    user?: unknown;
  } | null;

  if (!payload?.accessToken) return false;

  const prev = readPersistedSession();
  const nextRt =
    payload.refreshToken ?? prev?.refresh_token ?? payload.accessToken;
  await persistClientSessionAndSync(
    payload.accessToken,
    nextRt,
    payload.user ?? prev?.user ?? null,
  );
  return true;
}

async function refreshViaNativeSdk(): Promise<boolean> {
  const { data: userData, error: userErr } =
    await insforgeNative.auth.getCurrentUser();
  if (userErr || !userData?.user) {
    return false;
  }

  const { data: nativeData, error: nativeErr } =
    await insforgeNative.auth.refreshSession();
  if (
    nativeErr ||
    !nativeData?.accessToken ||
    typeof nativeData.accessToken !== "string"
  ) {
    return false;
  }

  const afterPrev = readPersistedSession();
  const nextRt = nativeData.refreshToken ?? afterPrev?.refresh_token;
  const user = nativeData.user ?? afterPrev?.user ?? null;
  if (nextRt) {
    await persistClientSessionAndSync(nativeData.accessToken, nextRt, user);
  } else {
    setSessionCookies(nativeData.accessToken);
    await fetch("/api/auth/sync-cookie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: nativeData.accessToken }),
    }).catch(() => {});
  }
  return true;
}

async function refreshViaProxyWithStoredToken(
  prev: PersistedShape,
): Promise<boolean> {
  return refreshWithStoredToken(prev.refresh_token, "refreshViaProxy");
}

let refreshInFlight: Promise<boolean> | null = null;
let lastRefreshAttemptAt = 0;
let lastWakeRefreshAt = 0;
let criticalSessionDepth = 0;
let sessionAuthDegraded = false;
let recoveryTimer: number | null = null;
let recoveryBackoffMs = AUTH_RECOVERY_INITIAL_BACKOFF_MS;

export function isCriticalSessionActive(): boolean {
  return criticalSessionDepth > 0;
}

export function isSessionAuthDegraded(): boolean {
  return sessionAuthDegraded;
}

function markSessionAuthRecovered(): void {
  if (!sessionAuthDegraded) return;
  sessionAuthDegraded = false;
  recoveryBackoffMs = AUTH_RECOVERY_INITIAL_BACKOFF_MS;
  window.dispatchEvent(new CustomEvent(SESSION_AUTH_RECOVERED_EVENT));
  stopAuthRecoveryLoop();
}

function markSessionAuthDegraded(): void {
  if (sessionAuthDegraded) return;
  sessionAuthDegraded = true;
  window.dispatchEvent(new CustomEvent(SESSION_AUTH_DEGRADED_EVENT));
}

function stopAuthRecoveryLoop(): void {
  if (recoveryTimer !== null) {
    window.clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
}

function scheduleAuthRecovery(resetBackoff = false): void {
  if (typeof window === "undefined") return;
  if (recoveryTimer !== null) return;
  if (resetBackoff) {
    recoveryBackoffMs = AUTH_RECOVERY_INITIAL_BACKOFF_MS;
  }

  recoveryTimer = window.setTimeout(() => {
    recoveryTimer = null;
    void runAuthRecoveryAttempt();
  }, recoveryBackoffMs);
}

async function runAuthRecoveryAttempt(): Promise<void> {
  if (isManualSignOutActive()) return;

  if (cookieAuthLooksValid()) {
    markSessionAuthRecovered();
    return;
  }

  if (isInsforgeRateLimited()) {
    recoveryBackoffMs = Math.min(
      recoveryBackoffMs * 2,
      AUTH_RECOVERY_MAX_BACKOFF_MS,
    );
    scheduleAuthRecovery();
    return;
  }

  await syncAccessTokenCookieFromStorage();
  if (cookieAuthLooksValid()) {
    markSessionAuthRecovered();
    return;
  }

  const ok = await forceRefreshAccessToken({
    urgent: true,
    bypassThrottle: accessJwtExpired(),
  });
  if (ok && cookieAuthLooksValid()) {
    markSessionAuthRecovered();
    return;
  }

  recoveryBackoffMs = Math.min(
    recoveryBackoffMs * 2,
    AUTH_RECOVERY_MAX_BACKOFF_MS,
  );
  scheduleAuthRecovery();
}

/** Register active call / PiP — blocks auto-logout (we never auto-logout regardless). */
export function subscribeCriticalSession(): () => void {
  criticalSessionDepth += 1;
  return () => {
    criticalSessionDepth = Math.max(0, criticalSessionDepth - 1);
    if (criticalSessionDepth === 0) {
      void tryRecoverAfterCriticalSession();
    }
  };
}

async function tryRecoverAfterCriticalSession(): Promise<void> {
  await refreshForUserRequest();
}

/** @deprecated No-op — auto-logout removed; kept for login form compatibility. */
export function resetSessionExpiredGuard(): void {}

/**
 * Silent auth recovery on 401 — never clears session or redirects to login.
 */
export function handleAuthFailure(): void {
  if (typeof window === "undefined") return;
  if (isManualSignOutActive()) return;
  markSessionAuthDegraded();
  scheduleAuthRecovery(true);
}

/** @deprecated Use handleAuthFailure */
export function notifySessionExpired(): void {
  handleAuthFailure();
}

/**
 * SDK httpOnly refresh first (OAuth), then localStorage refresh_token (email login).
 */
async function refreshAccessTokenBestEffort(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (isManualSignOutActive()) return false;

  // Never hit InsForge while the access JWT is still valid — failed proactive
  // refresh attempts were revoking OAuth refresh tokens (logs: 401 while cookieValid).
  if (cookieAuthLooksValid()) {
    markSessionAuthRecovered();
    return true;
  }

  const prev = readPersistedSession();

  if (prev?.refresh_token) {
    const proxyOk = await refreshViaProxyWithStoredToken(prev);
    if (proxyOk && cookieAuthLooksValid()) {
      markSessionAuthRecovered();
    }
    if (proxyOk) {
      return true;
    }
  }

  const cookieFallbackOk = await refreshViaCookieAccessTokenFallback();
  if (cookieFallbackOk && cookieAuthLooksValid()) {
    markSessionAuthRecovered();
  }
  if (cookieFallbackOk) {
    return true;
  }

  const credOk = await refreshViaBrowserCsrfProxy();
  if (credOk && cookieAuthLooksValid()) {
    markSessionAuthRecovered();
  }
  if (credOk) {
    return true;
  }

  const legacyCredOk = await refreshViaCredentialsIncludeProxy();
  if (legacyCredOk && cookieAuthLooksValid()) {
    markSessionAuthRecovered();
  }
  if (legacyCredOk) {
    return true;
  }

  const serverOk = await refreshViaServerSessionRoute();
  if (serverOk && cookieAuthLooksValid()) {
    markSessionAuthRecovered();
  }
  if (serverOk) {
    return true;
  }

  const sdkOk = await refreshViaNativeSdk();
  if (sdkOk) {
    if (cookieAuthLooksValid()) {
      markSessionAuthRecovered();
    }
    return true;
  }
  return false;
}

function mayAttemptRefreshNow(
  urgent: boolean,
  bypassThrottle: boolean,
): boolean {
  if (isInsforgeRateLimited()) return false;
  if (bypassThrottle) return true;
  const sinceLast = Date.now() - lastRefreshAttemptAt;
  const minGap = urgent ? URGENT_REFRESH_INTERVAL_MS : MIN_REFRESH_INTERVAL_MS;
  return sinceLast >= minGap;
}

export async function forceRefreshAccessToken(options?: {
  urgent?: boolean;
  /** When JWT is fully expired — allow refresh immediately (standby / user action). */
  bypassThrottle?: boolean;
}): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (isManualSignOutActive()) return false;

  const expired = accessJwtExpired();
  const urgent = options?.urgent ?? expired;
  const bypass = options?.bypassThrottle ?? expired;

  if (!mayAttemptRefreshNow(urgent, bypass)) {
    return cookieAuthLooksValid();
  }

  if (refreshInFlight) return refreshInFlight;

  lastRefreshAttemptAt = Date.now();
  refreshInFlight = refreshAccessTokenBestEffort().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Up to 3 fast refresh attempts for user actions / 401 / tab wake after standby.
 * Bypasses min-gap throttle while JWT is expired; still respects 429 cooldown.
 */
async function refreshForUserRequest(): Promise<boolean> {
  const session = readPersistedSession();
  await syncAccessTokenCookieFromStorage();
  if (cookieAuthLooksValid()) {
    markSessionAuthRecovered();
    return true;
  }

  for (let attempt = 0; attempt < USER_REQUEST_MAX_REFRESH_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(USER_REQUEST_RETRY_MS[attempt - 1] ?? 1200);
    }
    if (isInsforgeRateLimited()) break;

    await forceRefreshAccessToken({
      urgent: true,
      bypassThrottle: accessJwtExpired(),
    });
    await syncAccessTokenCookieFromStorage();
    if (cookieAuthLooksValid()) {
      markSessionAuthRecovered();
      return true;
    }
  }

  markSessionAuthDegraded();
  scheduleAuthRecovery(true);
  return false;
}

/** Lighter refresh path for call-room polling (max 2 attempts, throttled unless expired). */
async function refreshForCallApi(): Promise<boolean> {
  await syncAccessTokenCookieFromStorage();
  if (cookieAuthLooksValid()) {
    markSessionAuthRecovered();
    return true;
  }

  for (let attempt = 0; attempt < CALL_API_MAX_REFRESH_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(500);
    if (isInsforgeRateLimited()) break;

    await forceRefreshAccessToken({
      urgent: true,
      bypassThrottle: accessJwtExpired(),
    });
    await syncAccessTokenCookieFromStorage();
    if (cookieAuthLooksValid()) {
      markSessionAuthRecovered();
      return true;
    }
  }

  if (isCriticalSessionActive()) {
    markSessionAuthDegraded();
    scheduleAuthRecovery(true);
  }

  return false;
}

/**
 * Cheap local check + at most one throttled refresh before call API polling.
 */
export async function ensureAuthReadyForCallApi(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  return refreshForCallApi();
}

/** Fast recovery on 401 for user-initiated API calls (fetcher / authenticatedFetch). */
export async function recoverFromUnauthorized(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  return refreshForUserRequest();
}

export async function ensureFreshAccessToken(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (isManualSignOutActive()) return false;

  const session = readPersistedSession();
  if (session?.refresh_token && session.access_token) {
    await fetch("/api/auth/sync-cookie", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      }),
    }).catch(() => {});
  }

  await syncAccessTokenCookieFromStorage();
  if (cookieAuthLooksValid()) {
    return true;
  }
  return forceRefreshAccessToken({
    urgent: true,
    bypassThrottle: true,
  });
}

export async function restoreSessionIfPossible(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!hasRestorableClientSession()) return false;
  return ensureFreshAccessToken();
}

export function shouldProactivelyRefresh(): boolean {
  return accessTokenExpiresWithinSeconds(
    PROACTIVE_REFRESH_BEFORE_EXPIRY_SECONDS,
  );
}

/** Local JWT check; hits InsForge only when refresh is actually needed. */
export async function runSessionKeepAliveTick(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  await syncAccessTokenCookieFromStorage();

  if (cookieAuthLooksValid()) {
    return true;
  }

  return forceRefreshAccessToken({
    urgent: true,
    bypassThrottle: true,
  });
}

export async function prepareAuthenticatedRequest(): Promise<void> {
  if (typeof window === "undefined") return;
  await syncAccessTokenCookieFromStorage();
  if (cookieAuthLooksValid()) return;

  if (accessJwtExpired()) {
    await refreshForUserRequest();
  }
}

/** Tab wake: skip debounce when JWT expired; fast refresh after standby. */
export async function refreshSessionOnWake(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const expired = accessJwtExpired();
  const now = Date.now();
  if (!expired && now - lastWakeRefreshAt < SESSION_WAKE_DEBOUNCE_MS) {
    return cookieAuthLooksValid();
  }
  lastWakeRefreshAt = now;

  if (expired) {
    return refreshForUserRequest();
  }

  await syncAccessTokenCookieFromStorage();
  if (cookieAuthLooksValid()) {
    return true;
  }

  return forceRefreshAccessToken({ urgent: true, bypassThrottle: true });
}
