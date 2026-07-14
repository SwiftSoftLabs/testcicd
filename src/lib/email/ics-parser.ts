export interface ParsedIcsEvent {
  title?: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  isAllDay?: boolean;
  description?: string;
  location?: string;
}

type ParsedIcsLine = {
  key: string;
  params: Record<string, string>;
  value: string;
};

type ParsedDateValue = {
  value?: string;
  isAllDay: boolean;
  timezone?: string;
};

function isValidTimeZone(timeZone: string | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function unfoldIcsLines(icsText: string): string[] {
  const normalized = icsText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = normalized.split("\n");
  const unfolded: string[] = [];

  for (const row of rows) {
    if ((row.startsWith(" ") || row.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += row.slice(1);
      continue;
    }
    unfolded.push(row);
  }

  return unfolded;
}

function parseIcsLine(line: string): ParsedIcsLine | null {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) return null;

  const rawHead = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);
  const [rawKey, ...rawParams] = rawHead.split(";");
  if (!rawKey) return null;

  const params: Record<string, string> = {};
  for (const rawParam of rawParams) {
    const [paramKey, ...paramValueParts] = rawParam.split("=");
    if (!paramKey || paramValueParts.length === 0) continue;
    params[paramKey.toUpperCase()] = paramValueParts.join("=");
  }

  return {
    key: rawKey.toUpperCase(),
    params,
    value,
  };
}

function decodeIcsText(value: string): string {
  return value
    .replace(/\\\\/g, "\\")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";");
}

function parseDateOnly(value: string): string | undefined {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function shiftDateOnly(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getTimeZoneOffsetMs(timeZone: string, timestamp: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return asUtc - timestamp;
}

function buildUtcIsoFromTimeZone(
  value: string,
  timeZone: string,
): string | undefined {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let adjusted = utcGuess - getTimeZoneOffsetMs(timeZone, utcGuess);
  const refined = utcGuess - getTimeZoneOffsetMs(timeZone, adjusted);
  if (refined !== adjusted) {
    adjusted = refined;
  }

  return new Date(adjusted).toISOString();
}

function parseDateTimeValue(
  value: string,
  timeZone?: string,
): string | undefined {
  if (/^\d{8}$/.test(value)) {
    return parseDateOnly(value);
  }

  const utcMatch = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
  );
  if (utcMatch) {
    return new Date(
      Date.UTC(
        Number(utcMatch[1]),
        Number(utcMatch[2]) - 1,
        Number(utcMatch[3]),
        Number(utcMatch[4]),
        Number(utcMatch[5]),
        Number(utcMatch[6]),
      ),
    ).toISOString();
  }

  if (isValidTimeZone(timeZone)) {
    return buildUtcIsoFromTimeZone(value, timeZone);
  }

  const localMatch = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/,
  );
  if (!localMatch) return undefined;

  const localDate = new Date(
    Number(localMatch[1]),
    Number(localMatch[2]) - 1,
    Number(localMatch[3]),
    Number(localMatch[4]),
    Number(localMatch[5]),
    Number(localMatch[6]),
  );
  if (Number.isNaN(localDate.getTime())) return undefined;
  return localDate.toISOString();
}

function parseIcsDateField(field: ParsedIcsLine | undefined): ParsedDateValue {
  if (!field) return { isAllDay: false };

  const timeZone = isValidTimeZone(field.params.TZID)
    ? field.params.TZID
    : undefined;
  const isAllDay =
    field.params.VALUE?.toUpperCase() === "DATE" || /^\d{8}$/.test(field.value);
  const parsedValue = parseDateTimeValue(field.value, timeZone);

  return {
    value: parsedValue,
    isAllDay,
    timezone: timeZone,
  };
}

export function parseIcsEvent(icsText: string): ParsedIcsEvent | null {
  const lines = unfoldIcsLines(icsText);
  const startIndex = lines.findIndex(
    (line) => line.trim().toUpperCase() === "BEGIN:VEVENT",
  );
  if (startIndex === -1) return null;

  const eventLines: ParsedIcsLine[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    if (line.toUpperCase() === "END:VEVENT") break;
    const parsed = parseIcsLine(line);
    if (parsed) eventLines.push(parsed);
  }

  if (eventLines.length === 0) return null;

  const findLine = (key: string) => eventLines.find((line) => line.key === key);
  const summary = findLine("SUMMARY");
  const description = findLine("DESCRIPTION");
  const location = findLine("LOCATION");
  const dtStart = findLine("DTSTART");
  const dtEnd = findLine("DTEND");

  const start = parseIcsDateField(dtStart);
  const end = parseIcsDateField(dtEnd);
  const isAllDay = start.isAllDay;

  let endTime = end.value;
  if (isAllDay && endTime && /^\d{4}-\d{2}-\d{2}$/.test(endTime)) {
    endTime = shiftDateOnly(endTime, -1);
  }

  const parsedEvent: ParsedIcsEvent = {
    title: summary ? decodeIcsText(summary.value) : undefined,
    startTime: start.value,
    endTime: endTime ?? start.value,
    timezone:
      start.timezone ??
      end.timezone ??
      (dtStart?.value.endsWith("Z") ? "UTC" : undefined),
    isAllDay,
    description: description ? decodeIcsText(description.value) : undefined,
    location: location ? decodeIcsText(location.value) : undefined,
  };

  if (
    !parsedEvent.title &&
    !parsedEvent.startTime &&
    !parsedEvent.description &&
    !parsedEvent.location
  ) {
    return null;
  }

  return parsedEvent;
}
