import { createHash } from "node:crypto";

type Entry = { at: number; payload: string };

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 300;
const store = new Map<string, Entry>();

function prune(now: number) {
  if (store.size <= MAX_ENTRIES) return;
  const keys = [...store.entries()].sort((a, b) => a[1].at - b[1].at);
  const toDrop = Math.max(0, store.size - MAX_ENTRIES + 40);
  for (let i = 0; i < toDrop && i < keys.length; i++) {
    store.delete(keys[i][0]);
  }
  for (const [k, v] of store) {
    if (now - v.at > TTL_MS) store.delete(k);
  }
}

export function chatAiCacheKey(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function chatAiCacheGet(key: string): Record<string, unknown> | null {
  const now = Date.now();
  const hit = store.get(key);
  if (!hit || now - hit.at > TTL_MS) {
    if (hit) store.delete(key);
    return null;
  }
  try {
    return JSON.parse(hit.payload) as Record<string, unknown>;
  } catch {
    store.delete(key);
    return null;
  }
}

export function chatAiCacheSet(
  key: string,
  value: Record<string, unknown>,
): void {
  const now = Date.now();
  store.set(key, { at: now, payload: JSON.stringify(value) });
  prune(now);
}
