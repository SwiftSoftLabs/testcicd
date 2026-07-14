export type TaskAiSuggestionType =
  | "improve"
  | "proofread"
  | "subtasks"
  | "estimate";

export type NormalizedTaskAiSuggestion = {
  title?: string;
  description?: string;
  tags?: string[];
  subtasks?: string[];
  hours?: number;
  reasoning?: string;
};

export function normalizeTaskAiSuggestion(
  kind: TaskAiSuggestionType,
  raw: Record<string, unknown>,
): NormalizedTaskAiSuggestion {
  if (kind === "improve" || kind === "proofread") {
    const out: NormalizedTaskAiSuggestion = {};
    if (typeof raw.title === "string" && raw.title.trim())
      out.title = raw.title.trim();
    if (typeof raw.description === "string" && raw.description.trim()) {
      out.description = raw.description.trim();
    }
    if (Array.isArray(raw.tags)) {
      const tags = raw.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter(Boolean);
      if (tags.length) out.tags = tags;
    }
    return out;
  }

  if (kind === "subtasks") {
    const subs = raw.subtasks;
    if (!Array.isArray(subs)) return { subtasks: [] };
    const subtasks = subs
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean);
    return { subtasks };
  }

  const hoursRaw = raw.hours;
  let hours: number | undefined;
  if (typeof hoursRaw === "number" && Number.isFinite(hoursRaw))
    hours = hoursRaw;
  else if (typeof hoursRaw === "string") {
    const n = parseFloat(hoursRaw);
    if (Number.isFinite(n)) hours = n;
  }
  const reasoning =
    typeof raw.reasoning === "string"
      ? raw.reasoning.trim().slice(0, 500)
      : undefined;
  return { hours, reasoning };
}

export function hasImproveSuggestions(
  data: NormalizedTaskAiSuggestion,
): boolean {
  return !!(
    data.title ||
    data.description ||
    (data.tags && data.tags.length > 0)
  );
}
