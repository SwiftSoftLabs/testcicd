export type RecurrenceFrequency =
  | "daily"
  | "weekdays"
  | "weekends"
  | "weekly"
  | "monthly";

export const MAX_RECURRENCE_OCCURRENCES = 52;

export interface RecurrencePlanOptions {
  /** `null` = no cap; omit to default to MAX_RECURRENCE_OCCURRENCES (52). */
  maxOccurrences?: number | null;
}

export const CALENDAR_RECURRENCE_OPTIONS: RecurrencePlanOptions = {
  maxOccurrences: null,
};

export const CALLS_RECURRENCE_OPTIONS: RecurrencePlanOptions = {
  maxOccurrences: MAX_RECURRENCE_OCCURRENCES,
};

export interface RecurrencePlan {
  starts: string[];
  occurrenceCount: number;
  effectiveUntilIso: string;
  requestedUntilIso: string;
  truncatedByMax: boolean;
  startMatchesPattern: boolean;
  monthlyClamped: boolean;
}

function resolveMaxOccurrences(options?: RecurrencePlanOptions): number | null {
  if (options?.maxOccurrences === null) return null;
  if (typeof options?.maxOccurrences === "number") return options.maxOccurrences;
  return MAX_RECURRENCE_OCCURRENCES;
}

function canAddOccurrence(count: number, max: number | null): boolean {
  return max === null || count < max;
}

function isWeekday(d: Date): boolean {
  const dow = d.getDay();
  return dow >= 1 && dow <= 5;
}

function isWeekend(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function matchesDayPattern(d: Date, frequency: RecurrenceFrequency): boolean {
  if (frequency === "weekdays") return isWeekday(d);
  if (frequency === "weekends") return isWeekend(d);
  return true;
}

export function recurrenceStartMatchesPattern(
  startIso: string,
  frequency: RecurrenceFrequency,
): boolean {
  if (frequency !== "weekdays" && frequency !== "weekends") return true;
  const start = new Date(startIso);
  if (!Number.isFinite(start.getTime())) return false;
  return matchesDayPattern(start, frequency);
}

function withTimeFrom(source: Date, day: Date): Date {
  const occurrence = new Date(day);
  occurrence.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    0,
  );
  return occurrence;
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function isLastDayOfMonth(date: Date): boolean {
  return date.getDate() === lastDayOfMonth(date.getFullYear(), date.getMonth());
}

function addMonthsPreserveDay(
  anchor: Date,
  monthOffset: number,
): { date: Date; clamped: boolean } {
  const targetMonthIndex = anchor.getMonth() + monthOffset;
  const targetYear =
    anchor.getFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonth =
    ((targetMonthIndex % 12) + 12) % 12;
  const targetLastDay = lastDayOfMonth(targetYear, normalizedMonth);
  const anchorDay = anchor.getDate();
  const useLastDay = isLastDayOfMonth(anchor);
  const targetDay = useLastDay
    ? targetLastDay
    : Math.min(anchorDay, targetLastDay);

  const next = new Date(anchor);
  next.setFullYear(targetYear, normalizedMonth, targetDay);
  return { date: next, clamped: targetDay !== anchorDay };
}

function buildStartsFromPattern(
  firstStartIso: string,
  frequency: RecurrenceFrequency,
  untilIso: string,
  maxOccurrences: number | null,
): RecurrencePlan {
  const first = new Date(firstStartIso);
  const untilMs = new Date(untilIso).getTime();
  if (!Number.isFinite(untilMs) || !Number.isFinite(first.getTime())) {
    return {
      starts: [firstStartIso],
      occurrenceCount: 1,
      effectiveUntilIso: firstStartIso,
      requestedUntilIso: untilIso,
      truncatedByMax: false,
      startMatchesPattern: false,
      monthlyClamped: false,
    };
  }

  const starts: string[] = [];
  const dayCursor = new Date(first);
  dayCursor.setHours(0, 0, 0, 0);
  const startMatchesPattern = matchesDayPattern(first, frequency);

  if (first.getTime() <= untilMs) {
    starts.push(first.toISOString());
  }

  while (
    dayCursor.getTime() <= untilMs &&
    canAddOccurrence(starts.length, maxOccurrences)
  ) {
    dayCursor.setDate(dayCursor.getDate() + 1);
    if (!matchesDayPattern(dayCursor, frequency)) continue;

    const occurrence = withTimeFrom(first, dayCursor);
    if (occurrence.getTime() > untilMs) break;
    starts.push(occurrence.toISOString());
  }

  const effectiveUntilIso = starts[starts.length - 1] ?? firstStartIso;
  return {
    starts: starts.length > 0 ? starts : [firstStartIso],
    occurrenceCount: starts.length > 0 ? starts.length : 1,
    effectiveUntilIso,
    requestedUntilIso: untilIso,
    truncatedByMax:
      maxOccurrences !== null &&
      starts.length >= maxOccurrences &&
      new Date(effectiveUntilIso).getTime() < untilMs,
    startMatchesPattern,
    monthlyClamped: false,
  };
}

export function buildRecurrencePlan(
  firstStartIso: string,
  frequency: RecurrenceFrequency,
  untilIso: string,
  options?: RecurrencePlanOptions,
): RecurrencePlan {
  const maxOccurrences = resolveMaxOccurrences(options);

  if (frequency === "weekdays" || frequency === "weekends") {
    return buildStartsFromPattern(
      firstStartIso,
      frequency,
      untilIso,
      maxOccurrences,
    );
  }

  const untilMs = new Date(untilIso).getTime();
  const first = new Date(firstStartIso);
  if (!Number.isFinite(untilMs) || !Number.isFinite(first.getTime())) {
    return {
      starts: [firstStartIso],
      occurrenceCount: 1,
      effectiveUntilIso: firstStartIso,
      requestedUntilIso: untilIso,
      truncatedByMax: false,
      startMatchesPattern: false,
      monthlyClamped: false,
    };
  }

  const starts: string[] = [];
  let occurrenceIndex = 0;
  let monthlyClamped = false;

  while (canAddOccurrence(starts.length, maxOccurrences)) {
    let current = first;
    if (frequency === "daily") {
      current = new Date(first);
      current.setDate(first.getDate() + occurrenceIndex);
    } else if (frequency === "weekly") {
      current = new Date(first);
      current.setDate(first.getDate() + occurrenceIndex * 7);
    } else if (occurrenceIndex > 0) {
      const monthly = addMonthsPreserveDay(first, occurrenceIndex);
      current = monthly.date;
      monthlyClamped = monthlyClamped || monthly.clamped;
    }
    if (current.getTime() > untilMs) break;
    starts.push(current.toISOString());
    occurrenceIndex += 1;
  }

  const effectiveUntilIso = starts[starts.length - 1] ?? firstStartIso;
  return {
    starts: starts.length > 0 ? starts : [firstStartIso],
    occurrenceCount: starts.length > 0 ? starts.length : 1,
    effectiveUntilIso,
    requestedUntilIso: untilIso,
    truncatedByMax:
      maxOccurrences !== null &&
      starts.length >= maxOccurrences &&
      new Date(effectiveUntilIso).getTime() < untilMs,
    startMatchesPattern: true,
    monthlyClamped,
  };
}

/** Builds occurrence start ISO timestamps from first start through until (inclusive). */
export function expandRecurrenceOccurrences(
  firstStartIso: string,
  frequency: RecurrenceFrequency,
  untilIso: string,
  options?: RecurrencePlanOptions,
): string[] {
  return buildRecurrencePlan(
    firstStartIso,
    frequency,
    untilIso,
    options,
  ).starts;
}

export function recurrenceFrequencyLabel(
  frequency: RecurrenceFrequency,
): string {
  switch (frequency) {
    case "daily":
      return "Daily";
    case "weekdays":
      return "Weekdays (Mon–Fri)";
    case "weekends":
      return "Weekends (Sat–Sun)";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
  }
}

export function buildRecurrenceDescriptionNote(
  frequency: RecurrenceFrequency | null | undefined,
  untilIso: string | null | undefined,
  index?: number,
  total?: number,
): string | null {
  if (!frequency || !untilIso) return null;
  const untilLabel = new Date(untilIso).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
  const base = `Recurring ${recurrenceFrequencyLabel(frequency).toLowerCase()} until ${untilLabel}`;
  if (index != null && total != null && total > 1) {
    return `${base} (session ${index + 1} of ${total})`;
  }
  return base;
}

/** End of local calendar day for a YYYY-MM-DD date string. */
export function recurrenceUntilFromDateLocal(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59Z`).toISOString();
}
