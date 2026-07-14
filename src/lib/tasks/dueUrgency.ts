import { isPast, isToday } from "date-fns";

export type DueUrgency = "overdue" | "today" | "future" | "none";

// Parse date-only task due dates at local midnight to avoid UTC rollover bugs.
export function parseDueDateLocal(dueDate: string): Date {
  return new Date(`${dueDate}T00:00:00`);
}

export function getDueUrgency(dueDate: string | undefined): DueUrgency {
  if (!dueDate) return "none";

  const parsed = parseDueDateLocal(dueDate);
  if (Number.isNaN(parsed.getTime())) return "none";
  if (isPast(parsed) && !isToday(parsed)) return "overdue";
  if (isToday(parsed)) return "today";

  return "future";
}
