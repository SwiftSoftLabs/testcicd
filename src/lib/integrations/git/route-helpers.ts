import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getUserFromRequest } from "@/lib/db";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";

import type { GitProvider } from "@/types/git";
import { gitProviderSchema } from "./schemas";

export function jsonError(
  status: number,
  message: string,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json({ error: message }, { status, headers });
}

export function parseZodError(e: unknown): string {
  if (e instanceof ZodError) {
    return e.issues.map((i) => i.message).join("; ") || "Validation failed";
  }
  if (e instanceof Error) return e.message;
  return "Unexpected error";
}

export async function requireSessionUser(request: Request) {
  return getUserFromRequest(request);
}

export function parseProviderParam(raw: string): GitProvider {
  return gitProviderSchema.parse(raw);
}

export async function rateLimitGit(
  userId: string,
  provider: GitProvider,
): Promise<NextResponse | null> {
  const rate = checkSimpleRateLimit(`git:${userId}:${provider}`, 120, 60_000);
  if (!rate.allowed) {
    return jsonError(429, "Too many Git API requests. Retry shortly.", {
      "Retry-After": String(Math.ceil((rate.retryAfterMs || 0) / 1000)),
    });
  }
  return null;
}

export function mapUpstreamError(e: unknown): NextResponse {
  if (e instanceof ZodError) {
    return jsonError(400, parseZodError(e));
  }
  if (e instanceof Error) {
    const name = e.name;
    const msg = e.message;
    if (name === "UpstreamRateLimitError") {
      const retry =
        "retryAfterSeconds" in e
          ? (e as { retryAfterSeconds?: number }).retryAfterSeconds
          : undefined;
      return jsonError(
        429,
        msg,
        retry ? { "Retry-After": String(retry) } : undefined,
      );
    }
    if (name === "IntegrationNotFoundError") return jsonError(404, msg);
    if (name === "WorkspaceAccessError") return jsonError(404, msg);
    if (name === "InvalidTokenError") return jsonError(401, msg);
    if (name === "UpstreamError") {
      const st = "status" in e ? (e as { status: number }).status : 502;
      return jsonError(st >= 400 && st < 600 ? st : 502, msg);
    }
  }
  return jsonError(500, e instanceof Error ? e.message : "Server error");
}
