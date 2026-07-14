import {
  capTranscriptForMeetingAi,
  getOpenRouterChatModelId,
  getOpenRouterSummaryModelId,
  mapOpenRouterClientError,
  openRouterChatCompletion,
} from "@/lib/ai/openRouterChat";
import {
  parseMeetingJson,
  type MeetingAiOutput,
} from "@/lib/ai/meetingProcessor";
import type { LiveNote } from "@/types/calls";

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

const FULL_SYSTEM_INSTRUCTION =
  "You analyze a live workspace meeting. Respond with one JSON object only. " +
  "Keys: summary (max 3 sentences, rolling so far), keyDecisions (string[]), " +
  "actionItems (array of {title, description, suggestedAssigneeId, suggestedPriority, " +
  "suggestedDueDate, confidence}), liveNotes (string[] short bullets for this window only), " +
  "referencedTaskIds (string[]), risks (string[]). Do not invent facts. " +
  "When the transcript mentions tasks, todos, follow-ups, owners, or deadlines, " +
  "you MUST include at least one actionItems entry with a clear title.";

const NOTES_SYSTEM_INSTRUCTION =
  "You analyze a live workspace meeting. Respond with one JSON object only. " +
  "Keys: summary (max 3 sentences, rolling so far), keyDecisions (string[]), " +
  "liveNotes (string[] short bullets for new content in this window only). " +
  "Do not invent facts.";

const SUMMARY_SYSTEM_INSTRUCTION =
  "You analyze a completed workspace meeting. Respond with one JSON object only. " +
  "Keys: summary (max 4 sentences), keyDecisions (string[]), actionItems (array of " +
  "{title, description, suggestedAssigneeId, suggestedPriority, suggestedDueDate, confidence}), " +
  "referencedTaskIds (string[]), risks (string[]). Do not invent facts.";

export type LiveAiFromTextResult = {
  output: MeetingAiOutput;
  rawText: string;
  liveNoteBullets: string[];
};

export type LiveNotesFromTextResult = {
  summary: string;
  keyDecisions: string[];
  liveNoteBullets: string[];
};

/** Slice transcript for live AI: prefer delta since sinceCharCount, cap at 8K chars. */
export function transcriptSliceForAi(
  fullText: string,
  sinceCharCount?: number,
): string {
  const trimmed = fullText.trim();
  if (!trimmed) return "";
  if (
    sinceCharCount != null &&
    sinceCharCount >= 0 &&
    sinceCharCount < trimmed.length
  ) {
    const delta = trimmed.slice(sinceCharCount);
    if (delta.trim().length >= 40) {
      return delta.slice(-8_000);
    }
  }
  return trimmed.slice(-8_000);
}

export async function runLiveNotesFromText(
  transcriptText: string,
  opts?: { sinceCharCount?: number },
): Promise<LiveNotesFromTextResult> {
  const slice = transcriptSliceForAi(transcriptText, opts?.sinceCharCount);
  const prompt = [
    "## Meeting transcript (live, in progress)",
    slice,
    "",
    "Extract incremental meeting notes from what was said so far. " +
      "liveNotes should be short bullets for new points in this window only.",
  ].join("\n");

  const modelId = getOpenRouterChatModelId();

  try {
    const { text: rawText } = await openRouterChatCompletion({
      model: modelId,
      systemInstruction: NOTES_SYSTEM_INSTRUCTION,
      userPrompt: prompt,
      temperature: 0.15,
      maxTokens: 800,
      jsonMode: true,
    });

    let trimmed = rawText.trim();
    if (trimmed.startsWith("```")) {
      trimmed = trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      const parsed = parseMeetingJson(rawText);
      if (!parsed) throw new Error("Failed to parse live notes JSON");
      return {
        summary: parsed.summary,
        keyDecisions: parsed.keyDecisions,
        liveNoteBullets: parseLiveNotesFromRaw(rawText),
      };
    }
    const summary =
      typeof payload.summary === "string" ? payload.summary.trim() : "";
    const keyDecisions = Array.isArray(payload.keyDecisions)
      ? payload.keyDecisions.filter(
          (d): d is string => typeof d === "string" && d.trim().length > 0,
        )
      : [];
    return {
      summary: summary || "Meeting in progress.",
      keyDecisions,
      liveNoteBullets: parseLiveNotesFromRaw(rawText),
    };
  } catch (e: unknown) {
    const { message } = mapOpenRouterClientError(e);
    throw new Error(message);
  }
}

export async function runIncrementalMeetingAiFromText(
  transcriptText: string,
): Promise<LiveAiFromTextResult> {
  const prompt = [
    "## Meeting transcript (live, in progress)",
    capTranscriptForMeetingAi(transcriptText),
    "",
    "Extract incremental meeting outcomes from what was said so far. " +
      "Only add NEW action items not already implied by prior notes.",
  ].join("\n");

  const modelId = getOpenRouterSummaryModelId();

  try {
    const { text: rawText } = await openRouterChatCompletion({
      model: modelId,
      systemInstruction: FULL_SYSTEM_INSTRUCTION,
      userPrompt: prompt,
      temperature: 0.15,
      maxTokens: 2000,
      jsonMode: true,
    });
    const parsed = parseMeetingJson(rawText);
    if (!parsed) {
      throw new Error("Failed to parse meeting AI JSON");
    }
    return {
      output: parsed,
      rawText,
      liveNoteBullets: parseLiveNotesFromRaw(rawText),
    };
  } catch (e: unknown) {
    const { message } = mapOpenRouterClientError(e);
    throw new Error(message);
  }
}

export async function summarizeTranscriptWithMeetingAi(
  transcript: string,
  contextText: string,
): Promise<{ output: MeetingAiOutput; modelId: string }> {
  const capped = capTranscriptForMeetingAi(transcript);
  const prompt = [
    "## Meeting transcript",
    capped || "(empty transcript)",
    "",
    contextText,
    "",
    "Extract meeting outcomes from the transcript only.",
  ].join("\n");

  const modelId = getOpenRouterSummaryModelId();

  const { text } = await openRouterChatCompletion({
    model: modelId,
    systemInstruction: SUMMARY_SYSTEM_INSTRUCTION,
    userPrompt: prompt,
    temperature: 0.15,
    maxTokens: 2000,
    jsonMode: true,
  });

  const parsed = parseMeetingJson(text);
  if (!parsed) throw new Error("Could not parse summary from model gateway");
  return { output: parsed, modelId };
}
