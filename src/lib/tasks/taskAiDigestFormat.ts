/** Format POST /api/tasks/ai view_digest JSON for display. */
export function formatTaskViewDigestResponse(
  data: Record<string, unknown>,
): string {
  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  const focus = Array.isArray(data.focus)
    ? data.focus.filter((x): x is string => typeof x === "string")
    : [];
  const risks = Array.isArray(data.risks)
    ? data.risks.filter((x): x is string => typeof x === "string")
    : [];
  const parts: string[] = [];
  if (summary) parts.push(summary);
  if (focus.length)
    parts.push("Focus:\n" + focus.map((l) => `• ${l}`).join("\n"));
  if (risks.length)
    parts.push("Risks:\n" + risks.map((l) => `• ${l}`).join("\n"));
  return parts.join("\n\n") || "No summary returned.";
}

export function taskViewDigestSkippedCount(
  data: Record<string, unknown>,
): number {
  const n = data.digest_skipped_count;
  return typeof n === "number" && Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : 0;
}
