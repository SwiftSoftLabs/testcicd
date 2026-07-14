import {
  InsforgeRateLimitError,
  markInsforgeRateLimited,
} from "@/lib/insforgeRateLimit";

const RAW_INSFORGE_URL = process.env.NEXT_PUBLIC_INSFORGE_URL!;
const INSFORGE_API_KEY = process.env.INSFORGE_API_KEY!;
export const SCHEMA = process.env.NEXT_PUBLIC_DB_SCHEMA || "app_onework";

let INSFORGE_URL: string;
try {
  INSFORGE_URL = new URL(RAW_INSFORGE_URL).origin;
} catch {
  throw new Error(`Invalid NEXT_PUBLIC_INSFORGE_URL: "${RAW_INSFORGE_URL}"`);
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

const INSFORGE_FETCH_TIMEOUT_MS = 25_000;

function isRetryableFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const cause = (err as { cause?: { code?: string } }).cause;
  const code = cause?.code ?? "";
  return (
    msg.includes("fetch failed") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("connect timeout") ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET"
  );
}

async function insforgeFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const url = `${INSFORGE_URL}${path}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(INSFORGE_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      lastErr = err;
      if (attempt === 0 && isRetryableFetchError(err)) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  if (!INSFORGE_API_KEY) {
    throw new Error(
      "INSFORGE_API_KEY is not set. Add it to .env.local (server-only, no NEXT_PUBLIC_ prefix).",
    );
  }

  const response = await insforgeFetch("/api/database/advance/rawsql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${INSFORGE_API_KEY}`,
    },
    body: JSON.stringify({ query: text, params: params ?? [] }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429) {
      markInsforgeRateLimited();
      throw new InsforgeRateLimitError(
        "Database rate limit reached. Please wait before retrying.",
        90_000,
      );
    }
    throw new Error(`InsForge SQL error [${response.status}]: ${body}`);
  }

  const result = (await response.json()) as { rows: T[]; rowCount: number };
  return result;
}

/** Build INSERT SQL and params from a plain object. */
export function buildInsert(table: string, data: Record<string, unknown>) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const keys = entries.map(([k]) => k);
  const vals = entries.map(([, v]) => v);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  return {
    sql: `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    params: vals,
  };
}

/** Build SET clause and params for UPDATE SQL starting at $startIdx. */
export function buildSet(data: Record<string, unknown>, startIdx = 1) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const clause = entries.map(([k], i) => `${k} = $${startIdx + i}`).join(", ");
  const params = entries.map(([, v]) => v);
  return { clause, params, nextIdx: startIdx + entries.length };
}

const AUTH_CACHE_TTL_MS = 30_000;
const authCache = new Map<string, { user: { id: string; email: string }; expiresAt: number }>();

/** Get the authenticated user from the incoming request's sb-access-token cookie. */
export async function getUserFromRequest(
  request: Request,
): Promise<{ id: string; email: string } | null> {
  const cookieHeader = request.headers.get("cookie") || "";
  const tokenPart = cookieHeader
    .split(";")
    .find((c) => c.trim().startsWith("sb-access-token="));
  const tokenRaw = tokenPart?.split("=").slice(1).join("=").trim();
  if (!tokenRaw) return null;
  let token: string;
  try {
    token = decodeURIComponent(tokenRaw);
  } catch {
    token = tokenRaw;
  }

  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  try {
    const res = await insforgeFetch("/api/auth/sessions/current", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      authCache.delete(token);
      return null;
    }
    const data = await res.json();
    if (!data.user) return null;
    const user = { id: data.user.id, email: data.user.email };
    authCache.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
    return user;
  } catch {
    return null;
  }
}
