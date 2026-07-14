import type { Priority } from "@/types";

export type QuickTaskDraft = {
  title: string;
  description: string;
  priority: Priority;
  tags: string[];
};

function coercePriority(v: unknown): Priority {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  if (s === "urgent" || s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

export function parseQuickCreate(
  data: Record<string, unknown>,
): QuickTaskDraft | null {
  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!title) return null;
  const description =
    typeof data.description === "string" ? data.description.trim() : "";
  const priority = coercePriority(data.priority);
  let tags: string[] = [];
  if (Array.isArray(data.tags)) {
    tags = data.tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return { title, description, priority, tags };
}
