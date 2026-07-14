const inMemoryBuckets = new Map<string, number[]>();

export function checkSimpleRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const existing = inMemoryBuckets.get(key) || [];
  const fresh = existing.filter((ts) => now - ts < windowMs);
  if (fresh.length >= limit) {
    const retryAfterMs = windowMs - (now - fresh[0]);
    inMemoryBuckets.set(key, fresh);
    return { allowed: false, retryAfterMs };
  }
  fresh.push(now);
  inMemoryBuckets.set(key, fresh);
  return { allowed: true };
}
