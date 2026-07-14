import {
  handleAuthFailure,
  prepareAuthenticatedRequest,
  recoverFromUnauthorized,
} from "@/lib/auth/client-session";

/**
 * Same-origin fetch with session cookie sync, proactive refresh, and 401 retry.
 * Never auto-logouts — failed auth schedules silent recovery instead.
 */
export async function authenticatedFetch(
  url: string,
  options?: RequestInit,
  retriedAfterRefresh = false,
): Promise<Response> {
  if (typeof window !== "undefined") {
    await prepareAuthenticatedRequest();
  }

  const res = await fetch(url, {
    credentials: "include",
    ...options,
  });

  if (
    res.status === 401 &&
    !retriedAfterRefresh &&
    typeof window !== "undefined"
  ) {
    const recovered = await recoverFromUnauthorized();
    if (recovered) {
      return authenticatedFetch(url, options, true);
    }
    if (!recovered) {
      handleAuthFailure();
    }
  }

  return res;
}
