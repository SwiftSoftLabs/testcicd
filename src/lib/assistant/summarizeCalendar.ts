import { GoogleGenAI } from "@google/genai";
import { getGeminiModelId } from "@/lib/ai/geminiModel";
import { mapGeminiClientError } from "@/lib/ai/geminiErrors";
import { query, SCHEMA } from "@/lib/db";

export type CalendarEventSummaryRow = {
  title: string;
  startTime: string;
  endTime: string;
};

export async function loadUpcomingCalendarEvents(opts: {
  workspaceId: string;
  projectId?: string | null;
  limit?: number;
}): Promise<CalendarEventSummaryRow[]> {
  const limit = opts.limit ?? 20;
  const params: unknown[] = [opts.workspaceId];
  let projectClause = "";
  if (opts.projectId) {
    params.push(opts.projectId);
    projectClause = ` AND e.project_id = $${params.length}::uuid`;
  }
  params.push(limit);

  const res = await query<{
    title: string;
    start_time: string;
    end_time: string;
  }>(
    `SELECT e.title, e.start_time, e.end_time
     FROM ${SCHEMA}.calendar_events e
     INNER JOIN ${SCHEMA}.calendars c ON c.id = e.calendar_id
     WHERE c.workspace_id = $1::uuid
       AND e.start_time >= NOW() - INTERVAL '1 day'
       ${projectClause}
     ORDER BY e.start_time ASC
     LIMIT $${params.length}`,
    params,
  );

  return res.rows.map((r) => ({
    title: r.title,
    startTime: r.start_time,
    endTime: r.end_time,
  }));
}

export async function summarizeCalendarEvents(opts: {
  apiKey: string;
  events: CalendarEventSummaryRow[];
}): Promise<string> {
  if (!opts.events.length) {
    return "Nothing scheduled on your calendar in the near term.";
  }

  const lines = opts.events.slice(0, 12).map((e) => {
    const start = new Date(e.startTime);
    const when = Number.isNaN(start.getTime())
      ? e.startTime
      : start.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
    return `- ${e.title} (${when})`;
  });

  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  try {
    const result = await ai.models.generateContent({
      model: getGeminiModelId(),
      contents: [
        "Summarize this calendar schedule in 2-4 short sentences for a voice toast. Be factual.\n\n",
        lines.join("\n"),
      ].join(""),
      config: { temperature: 0.2, maxOutputTokens: 280 },
    });
    const text = result.text?.trim();
    if (text) return text.slice(0, 900);
  } catch (e: unknown) {
    const mapped = mapGeminiClientError(e);
    throw Object.assign(new Error(mapped.message), {
      httpStatus: mapped.httpStatus,
    });
  }

  return `You have ${opts.events.length} upcoming events. Next: ${lines.slice(0, 3).join(" ")}`;
}
