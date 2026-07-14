import { z } from "zod";

import type { PullRequestActivityCheck } from "@/types";

const checkRunsSchema = z.object({
  check_runs: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable().optional(),
      html_url: z.string().nullable().optional(),
    }),
  ),
});

const statusesSchema = z.array(
  z.object({
    id: z.number().optional(),
    context: z.string(),
    state: z.string(),
    target_url: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }),
);

/** Map classic commit status state → check-style conclusion. */
function statusStateToConclusion(state: string): string | null {
  const s = state.toLowerCase();
  if (s === "success") return "success";
  if (s === "failure" || s === "error") return "failure";
  if (s === "pending") return null;
  return s;
}

function statusStateToStatus(state: string): string {
  const s = state.toLowerCase();
  if (s === "pending") return "in_progress";
  return "completed";
}

export function parseCheckRunsJson(data: unknown): PullRequestActivityCheck[] {
  const raw = checkRunsSchema.safeParse(data);
  if (!raw.success) return [];
  return raw.data.check_runs.map((cr) => ({
    id: String(cr.id),
    name: cr.name,
    status: cr.status,
    conclusion: cr.conclusion ?? null,
    html_url: cr.html_url ?? null,
  }));
}

/** Deduplicate statuses by context (latest first wins if array is newest-first). */
export function parseCommitStatusesJson(
  data: unknown,
): PullRequestActivityCheck[] {
  const raw = statusesSchema.safeParse(data);
  if (!raw.success) return [];
  const seen = new Set<string>();
  const out: PullRequestActivityCheck[] = [];
  for (const st of raw.data) {
    if (seen.has(st.context)) continue;
    seen.add(st.context);
    out.push({
      id: `status:${st.context}:${st.id ?? st.state}`,
      name: st.context,
      status: statusStateToStatus(st.state),
      conclusion: statusStateToConclusion(st.state),
      html_url: st.target_url ?? null,
    });
  }
  return out;
}

export function isCheckPending(c: PullRequestActivityCheck): boolean {
  const status = c.status.toLowerCase();
  if (
    status === "queued" ||
    status === "pending" ||
    status === "in_progress" ||
    status === "waiting" ||
    status === "requested" ||
    status === "running"
  ) {
    return true;
  }
  if (status === "completed") return false;
  return c.conclusion == null;
}

export function isCheckFailure(c: PullRequestActivityCheck): boolean {
  const conclusion = (c.conclusion ?? "").toLowerCase();
  return (
    conclusion === "failure" ||
    conclusion === "cancelled" ||
    conclusion === "canceled" ||
    conclusion === "timed_out" ||
    conclusion === "action_required" ||
    conclusion === "error"
  );
}

export function pullRequestChecksBlockMerge(
  checks: PullRequestActivityCheck[],
  requiredNames?: string[],
): { blocked: boolean; reason?: string } {
  if (checks.length === 0) {
    return { blocked: false };
  }

  const required =
    requiredNames && requiredNames.length > 0
      ? checks.filter((c) =>
          requiredNames.some(
            (name) => name.toLowerCase() === c.name.toLowerCase(),
          ),
        )
      : checks;

  if (required.length === 0 && requiredNames && requiredNames.length > 0) {
    return {
      blocked: true,
      reason: `Required status checks are missing: ${requiredNames.join(", ")}`,
    };
  }

  for (const c of required) {
    if (isCheckFailure(c)) {
      return {
        blocked: true,
        reason: `Status check "${c.name}" failed.`,
      };
    }
    if (isCheckPending(c)) {
      return {
        blocked: true,
        reason: `Status check "${c.name}" is still pending.`,
      };
    }
  }

  return { blocked: false };
}

export function summarizeChecks(checks: PullRequestActivityCheck[]): {
  pass: number;
  pending: number;
  fail: number;
  total: number;
  aggregate: "pass" | "pending" | "fail" | "empty";
} {
  let pass = 0;
  let pending = 0;
  let fail = 0;
  for (const c of checks) {
    if (isCheckFailure(c)) fail += 1;
    else if (isCheckPending(c)) pending += 1;
    else pass += 1;
  }
  const total = checks.length;
  const aggregate =
    total === 0
      ? "empty"
      : fail > 0
        ? "fail"
        : pending > 0
          ? "pending"
          : "pass";
  return { pass, pending, fail, total, aggregate };
}
