/** Date/time helpers and duration presets for EventModal scheduling UI. */

export type EventDurationPreset = 15 | 30 | 45 | 60 | 90 | 120 | "custom";

export const EVENT_DURATION_PRESET_MINUTES: readonly EventDurationPreset[] = [
  15, 30, 45, 60, 90, 120,
];

export const EVENT_DURATION_OPTIONS: ReadonlyArray<{
  value: EventDurationPreset;
  label: string;
}> = [
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1.5 hours" },
  { value: 120, label: "2 hours" },
  { value: "custom", label: "Custom" },
];

export function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toDateLocal(value: string): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toTimeLocal(value: string): string {
  if (!value) return "09:00";
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(11, 16);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "09:00";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function combineDateAndTime(date: string, time: string): string {
  if (!date) return "";
  if (!time) return `${date}T09:00`;
  return `${date}T${time}`;
}

export function splitDateTimeLocal(value: string): { date: string; time: string } {
  return {
    date: toDateLocal(value),
    time: toTimeLocal(value),
  };
}

export function normalizeInputValue(value: string, allDay: boolean): string {
  return allDay ? toDateLocal(value) : toDateTimeLocal(value);
}

export function fromDateTimeLocal(
  value: string,
  allDay: boolean,
  isEnd = false,
): string {
  if (allDay) {
    return new Date(`${value}T${isEnd ? "23:59:59" : "00:00:00"}`).toISOString();
  }
  return new Date(value).toISOString();
}

export function shiftLocalDateTime(value: string, minutes: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setMinutes(date.getMinutes() + minutes);
  return toDateTimeLocal(date.toISOString());
}

export function addMinutesToDateTimeLocal(
  dateTimeLocal: string,
  minutes: number,
): string {
  return shiftLocalDateTime(dateTimeLocal, minutes);
}

export function durationMinutesBetween(
  startLocal: string,
  endLocal: string,
  allDay: boolean,
): number | null {
  if (!startLocal || !endLocal) return null;
  const startMs = Date.parse(fromDateTimeLocal(startLocal, allDay));
  const endMs = Date.parse(fromDateTimeLocal(endLocal, allDay, true));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  return Math.round((endMs - startMs) / 60_000);
}

export function inferDurationPreset(
  startLocal: string,
  endLocal: string,
  allDay: boolean,
): EventDurationPreset {
  if (allDay) return "custom";
  const minutes = durationMinutesBetween(startLocal, endLocal, allDay);
  if (minutes == null) return 60;
  if (EVENT_DURATION_PRESET_MINUTES.includes(minutes as EventDurationPreset)) {
    return minutes as EventDurationPreset;
  }
  return "custom";
}

export function formatDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function formatTimeLabel(dateTimeLocal: string): string {
  const date = new Date(dateTimeLocal);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "Select date";
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
