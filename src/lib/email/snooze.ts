export type SnoozePresetId = "later-today" | "tomorrow" | "next-week";

export const SNOOZE_PRESETS: { id: SnoozePresetId; label: string }[] = [
  { id: "later-today", label: "Later today" },
  { id: "tomorrow", label: "Tomorrow morning" },
  { id: "next-week", label: "Next week" },
];

function atHour(base: Date, hour: number, minute = 0): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function startOfDay(base: Date): Date {
  return atHour(base, 0);
}

export function snoozePresetUntil(
  preset: SnoozePresetId,
  now = new Date(),
): Date {
  switch (preset) {
    case "later-today": {
      const sixPm = atHour(now, 18);
      if (sixPm.getTime() <= now.getTime()) {
        return new Date(now.getTime() + 3 * 60 * 60 * 1000);
      }
      return sixPm;
    }
    case "tomorrow": {
      const d = atHour(now, 9);
      d.setDate(d.getDate() + 1);
      return d;
    }
    case "next-week": {
      const d = atHour(now, 9);
      const day = d.getDay();
      const daysUntilMonday = day === 0 ? 1 : 8 - day;
      d.setDate(d.getDate() + daysUntilMonday);
      return d;
    }
  }
}

export function isCurrentlySnoozed(
  email: { snoozed_until?: string | null },
  now = new Date(),
): boolean {
  if (!email.snoozed_until) return false;
  return new Date(email.snoozed_until).getTime() > now.getTime();
}

export function formatSnoozedUntil(iso: string, now = new Date()): string {
  const target = new Date(iso);
  if (target.getTime() <= now.getTime()) return "Now";

  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDay = startOfDay(target);

  const time = target.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  if (targetDay.getTime() === today.getTime()) return `Today ${time}`;
  if (targetDay.getTime() === tomorrow.getTime()) return `Tomorrow ${time}`;

  return target.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function minDatetimeLocalValue(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
