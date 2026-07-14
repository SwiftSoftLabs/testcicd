import type { EmailMessage, MailAccountStatus } from "@/types";

const STATUS_TTL_MS = 75_000;
const LIST_TTL_MS = 45_000;
const DEFAULT_LIST_LIMIT = 200;

type StatusEntry = { data: MailAccountStatus; at: number };
type ListEntry = { rows: EmailMessage[]; at: number };

let statusCache: StatusEntry | null = null;
const listCache = new Map<string, ListEntry>();

export function readMailboxStatusCache(): MailAccountStatus | null {
  if (!statusCache || Date.now() - statusCache.at > STATUS_TTL_MS) return null;
  return statusCache.data;
}

export function writeMailboxStatusCache(data: MailAccountStatus): void {
  statusCache = { data, at: Date.now() };
}

export function bustMailboxStatusCache(): void {
  statusCache = null;
}

export function readMailboxListCache(folder: string): EmailMessage[] | null {
  const hit = listCache.get(folder);
  if (!hit || Date.now() - hit.at > LIST_TTL_MS) return null;
  return hit.rows;
}

export function writeMailboxListCache(
  folder: string,
  rows: EmailMessage[],
): void {
  listCache.set(folder, { rows, at: Date.now() });
}

/** Call after mutations or explicit refresh. */
export function bustMailboxListCache(folder?: string): void {
  if (folder) listCache.delete(folder);
  else listCache.clear();
}

/** Notify sidebar (and other listeners) to refresh inbox unread count. */
export function notifyEmailUnreadChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("emailUnreadUpdated"));
}

export function defaultMailboxListLimit(): number {
  return DEFAULT_LIST_LIMIT;
}
