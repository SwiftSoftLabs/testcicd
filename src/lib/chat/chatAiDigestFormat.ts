export type ChatThreadDigest = {
  summary: string;
  focus: string[];
  openQuestions: string[];
};

export function parseChatThreadDigest(data: Record<string, unknown>): ChatThreadDigest {
  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  const focus = Array.isArray(data.focus)
    ? data.focus
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
    : [];
  const openQuestions = Array.isArray(data.open_questions)
    ? data.open_questions
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
    : [];
  return { summary, focus, openQuestions };
}

export function formatChatThreadDigest(data: Record<string, unknown>): string {
  const { summary, focus, openQuestions } = parseChatThreadDigest(data);
  const parts: string[] = [];
  if (summary) parts.push(summary);
  if (focus.length) {
    parts.push("");
    parts.push("Focus:");
    focus.forEach((f) => parts.push(`• ${f}`));
  }
  if (openQuestions.length) {
    parts.push("");
    parts.push("Open questions:");
    openQuestions.forEach((q) => parts.push(`• ${q}`));
  }
  return parts.join("\n").trim() || "No summary available.";
}
