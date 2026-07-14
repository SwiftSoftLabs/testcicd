import type { CalendarEventDTO } from '@/types/calendar';

export function formatEventRange(
  event: Pick<CalendarEventDTO, 'startTime' | 'endTime' | 'isAllDay'>,
): string {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
  };

  if (event.isAllDay) {
    const startLabel = start.toLocaleDateString(undefined, dateOpts);
    const endLabel = end.toLocaleDateString(undefined, dateOpts);
    return startLabel === endLabel ? `${startLabel} (all day)` : `${startLabel} – ${endLabel} (all day)`;
  }

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (sameDay) {
    return `${start.toLocaleDateString(undefined, dateOpts)}, ${start.toLocaleTimeString(undefined, timeOpts)} – ${end.toLocaleTimeString(undefined, timeOpts)}`;
  }

  return `${start.toLocaleString(undefined, { ...dateOpts, ...timeOpts })} – ${end.toLocaleString(undefined, { ...dateOpts, ...timeOpts })}`;
}

export function calendarEventDeepLink(eventId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
  return base ? `${base}/calendar?eventId=${eventId}` : `/calendar?eventId=${eventId}`;
}
