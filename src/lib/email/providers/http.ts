const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export type ProviderFetchInit = RequestInit & {
  timeoutMs?: number;
  retries?: number;
};

export async function providerFetch(
  url: string,
  init: ProviderFetchInit = {},
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = init.retries ?? MAX_RETRIES;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (
        (res.status === 429 || res.status === 503) &&
        attempt < retries
      ) {
        const retryAfter = res.headers.get("Retry-After");
        const delayMs = retryAfter
          ? Math.max(1000, Number.parseInt(retryAfter, 10) * 1000)
          : Math.min(8000, 1000 * 2 ** attempt);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      return res;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Provider fetch failed");
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("Provider fetch failed");
}

export async function providerFetchJson<T>(
  url: string,
  init: ProviderFetchInit = {},
): Promise<T> {
  const res = await providerFetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number };
  };
  if (!res.ok) {
    const message =
      (data as { error?: { message?: string } }).error?.message ||
      `Provider request failed (${res.status})`;
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}
