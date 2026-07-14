import {
  capTranscriptForMeetingAi,
  getOpenRouterSummaryModelId,
  isOpenRouterMeetingAiConfigured,
  mapOpenRouterClientError,
  openRouterChatCompletion,
} from "@/lib/ai/openRouterChat";
import {
  buildMeetingContextBundle,
  formatContextForPrompt,
} from "@/lib/ai/meetingContext";
import {
  parseMeetingJson,
  type MeetingAiOutput,
} from "@/lib/ai/meetingProcessor";
import { createDraftMeetingTask } from "@/lib/ai/meetingTools";
import { query, SCHEMA } from "@/lib/db";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";
import { buildTranscriptText } from "@/lib/calls/transcriptSegments";
import type { CallSessionRow, LiveNote, TranscriptSegment } from "@/types/calls";

const MIN_CHARS_SINCE_LAST = 25;
const MIN_MS_SINCE_LAST = 5_000;

const FINAL_PASS_SYSTEM_INSTRUCTION =
  "You analyze a live workspace meeting. Respond with one JSON object only. " +
  "Keys: summary (max 3 sentences, rolling so far), keyDecisions (string[]), " +
  "actionItems (array of {title, description, suggestedAssigneeId, suggestedPriority, " +
  "suggestedDueDate, confidence}), liveNotes (string[] short bullets for this window only), " +
  "referencedTaskIds (string[]), risks (string[]). Do not invent facts. " +
  "When the transcript mentions tasks, todos, follow-ups, owners, or deadlines, " +
  "you MUST include at least one actionItems entry with a clear title.";

const inFlight = new Set<string>();

async function existingTaskTitles(callId: string): Promise<string[]> {
  const res = await query<{ title: string }>(
    `SELECT title FROM ${SCHEMA}.tasks WHERE source_call_id = $1`,
    [callId],
  );
  return res.rows.map((r) => r.title.toLowerCase());
}

function isDuplicateTitle(title: string, existing: string[]): boolean {
  const t = title.toLowerCase().trim();
  return existing.some((e) => e === t || e.includes(t) || t.includes(e));
}

function transcriptText(
  segments: TranscriptSegment[],
  fullText: string | null,
): string {
  return buildTranscriptText(segments, fullText);
}

function parseLiveNotesFromRaw(text: string): string[] {
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }
  try {
    const raw = JSON.parse(trimmed) as { liveNotes?: unknown };
    if (!Array.isArray(raw.liveNotes)) return [];
    return raw.liveNotes.filter(
      (n): n is string => typeof n === "string" && n.trim().length > 0,
    );
  } catch {
    return [];
  }
}

async function runMeetingAiPass(
  callId: string,
  opts: { requireLive: boolean; skipThrottle: boolean; force?: boolean },
): Promise<void> {
  if (inFlight.has(callId)) return;

  if (!opts.skipThrottle) {
    const rate = checkSimpleRateLimit(`call-live-ai:${callId}`, 10, 60_000);
    if (!rate.allowed) return;
  }

  const callRes = await query<CallSessionRow>(
    `SELECT * FROM ${SCHEMA}.call_sessions WHERE id = $1 LIMIT 1`,
    [callId],
  );
  const call = callRes.rows[0];
  if (!call?.ai_enabled) return;
  if (opts.requireLive && call.status !== "live") return;
  if (
    !opts.requireLive &&
    !["live", "processing"].includes(call.status)
  ) {
    return;
  }

  const meta = (call.metadata ?? {}) as {
    last_live_ai_at?: string;
    last_live_ai_char_count?: number;
  };
  const trRes = await query<{
    full_text: string | null;
    segments: TranscriptSegment[];
  }>(
    `SELECT full_text, segments FROM ${SCHEMA}.call_transcripts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [callId],
  );
  const tr = trRes.rows[0];
  if (!tr) return;

  const text = transcriptText(tr.segments ?? [], tr.full_text);
  if (!text.trim()) return;

  const charCount = text.length;
  const neverRun = !meta.last_live_ai_at;
  if (!opts.skipThrottle && !opts.force && !neverRun) {
    const lastChars = meta.last_live_ai_char_count ?? 0;
    const lastAt = new Date(meta.last_live_ai_at!).getTime();
    const elapsed = Date.now() - lastAt;
    if (
      charCount - lastChars < MIN_CHARS_SINCE_LAST &&
      elapsed < MIN_MS_SINCE_LAST
    ) {
      return;
    }
  }

  if (!isOpenRouterMeetingAiConfigured()) return;

  inFlight.add(callId);
  await query(
    `UPDATE ${SCHEMA}.call_sessions
     SET metadata = metadata || $2::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [callId, JSON.stringify({ live_ai_running: true })],
  );
  try {
    const participantsRes = await query<{ user_id: string }>(
      `SELECT user_id FROM ${SCHEMA}.call_participants WHERE call_session_id = $1`,
      [callId],
    );
    const participantIds = participantsRes.rows.map((p) => p.user_id);
    const bundle = await buildMeetingContextBundle(call, participantIds);
    const contextText = formatContextForPrompt(bundle);

    const prompt = [
      "## Meeting transcript (live, in progress)",
      capTranscriptForMeetingAi(text),
      "",
      contextText,
      "",
      "Extract incremental meeting outcomes from what was said so far. " +
        "Only add NEW action items not already implied by prior notes.",
    ].join("\n");

    const modelId = getOpenRouterSummaryModelId();

    let parsed: MeetingAiOutput | null = null;
    let rawText = "";
    try {
      const result = await openRouterChatCompletion({
        model: modelId,
        systemInstruction: FINAL_PASS_SYSTEM_INSTRUCTION,
        userPrompt: prompt,
        temperature: 0.15,
        maxTokens: 2000,
        jsonMode: true,
      });
      rawText = result.text;
      parsed = parseMeetingJson(rawText);
    } catch (e: unknown) {
      const { message } = mapOpenRouterClientError(e);
      console.error("[runFinalMeetingAiPass]", callId, message);
      return;
    }

    if (!parsed) return;

    const artRes = await query<{
      id: string;
      live_notes: LiveNote[];
    }>(
      `SELECT id, live_notes FROM ${SCHEMA}.call_ai_artifacts
       WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [callId],
    );
    const art = artRes.rows[0];
    const existingNotes = Array.isArray(art?.live_notes) ? art.live_notes : [];
    const nowMs = call.started_at
      ? Date.now() - new Date(call.started_at).getTime()
      : Date.now();

    const liveNotesFromAi = parseLiveNotesFromRaw(rawText);
    const newBullets: LiveNote[] = liveNotesFromAi.map((t) => ({
      at_ms: nowMs,
      text: t.trim().slice(0, 500),
    }));

    const mergedNotes = [...existingNotes, ...newBullets].slice(-80);

    if (art) {
      if (opts.requireLive) {
        await query(
          `UPDATE ${SCHEMA}.call_ai_artifacts
           SET summary = $2, key_decisions = $3::jsonb, live_notes = $4::jsonb,
               raw_response = $5::jsonb, model_id = $6
           WHERE id = $1`,
          [
            art.id,
            parsed.summary,
            JSON.stringify(parsed.keyDecisions),
            JSON.stringify(mergedNotes),
            JSON.stringify({ ...parsed, liveNotes: liveNotesFromAi }),
            modelId,
          ],
        );
      } else {
        await query(
          `UPDATE ${SCHEMA}.call_ai_artifacts
           SET summary = $2, key_decisions = $3::jsonb, live_notes = $4::jsonb,
               raw_response = $5::jsonb, model_id = $6, status = 'ready'
           WHERE id = $1`,
          [
            art.id,
            parsed.summary,
            JSON.stringify(parsed.keyDecisions),
            JSON.stringify(mergedNotes),
            JSON.stringify({ ...parsed, liveNotes: liveNotesFromAi }),
            modelId,
          ],
        );
      }
    } else {
      await query(
        `INSERT INTO ${SCHEMA}.call_ai_artifacts
         (call_session_id, summary, key_decisions, live_notes, raw_response, model_id, status)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          callId,
          parsed.summary,
          JSON.stringify(parsed.keyDecisions),
          JSON.stringify(mergedNotes),
          JSON.stringify({ ...parsed, liveNotes: liveNotesFromAi }),
          modelId,
          opts.requireLive ? "processing" : "ready",
        ],
      );
    }

    const existing = await existingTaskTitles(callId);
    let tasksCreated = 0;
    for (const item of parsed.actionItems) {
      if (isDuplicateTitle(item.title, existing)) continue;
      try {
        await createDraftMeetingTask(call, item, call.created_by);
        existing.push(item.title.toLowerCase());
        tasksCreated += 1;
      } catch (e: unknown) {
        console.error(
          "[liveMeetingAi] createDraftMeetingTask",
          callId,
          item.title,
          e,
        );
      }
    }

    await query(
      `UPDATE ${SCHEMA}.call_sessions
       SET metadata = metadata || $2::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [
        callId,
        JSON.stringify({
          last_live_ai_at: new Date().toISOString(),
          last_live_ai_char_count: charCount,
          last_live_ai_tasks_created: tasksCreated,
          ...(!opts.requireLive
            ? { final_live_ai_at: new Date().toISOString() }
            : {}),
        }),
      ],
    );
  } finally {
    inFlight.delete(callId);
    await query(
      `UPDATE ${SCHEMA}.call_sessions
       SET metadata = metadata || $2::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [callId, JSON.stringify({ live_ai_running: false })],
    );
  }
}

export async function maybeRunIncrementalMeetingAi(
  callId: string,
  opts?: { force?: boolean },
): Promise<void> {
  return runMeetingAiPass(callId, {
    requireLive: true,
    skipThrottle: false,
    force: opts?.force,
  });
}

/** One last notes + task pass when the call ends (uses live transcript). */
export async function runFinalMeetingAiPass(callId: string): Promise<void> {
  return runMeetingAiPass(callId, { requireLive: false, skipThrottle: true });
}
