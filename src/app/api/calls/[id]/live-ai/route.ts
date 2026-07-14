import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import {
  runIncrementalMeetingAiFromText,
  runLiveNotesFromText,
  transcriptSliceForAi,
} from "@/lib/calls/liveMeetingAiClient";
import { buildTranscriptText } from "@/lib/calls/transcriptSegments";
import { isCallDevSttOnlyServer } from "@/lib/calls/constants";
import { isOpenRouterMeetingAiConfigured } from "@/lib/ai/openRouterChat";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";
import type { LiveNote, TranscriptSegment } from "@/types/calls";
import type { LocalTasksPipelineStage } from "@/lib/calls/localCallSession";

const segmentSchema = z.object({
  text: z.string(),
  start_ms: z.number().int().min(0),
  end_ms: z.number().int().min(0),
  speaker_user_id: z.union([z.string().uuid(), z.null()]).optional(),
  participant_identity: z.string().nullable().optional(),
  is_final: z.boolean().optional(),
  sentence_id: z.number().int().nullable().optional(),
});

const bodySchema = z.object({
  segments: z.array(segmentSchema).max(2000),
  mode: z.enum(["notes", "tasks"]).optional().default("notes"),
  sinceCharCount: z.number().int().min(0).optional(),
});

async function canWriteTranscript(
  callId: string,
  userId: string,
  createdBy: string,
): Promise<boolean> {
  if (userId === createdBy) return true;
  const res = await query<{ role: string }>(
    `SELECT role FROM ${SCHEMA}.call_participants
     WHERE call_session_id = $1 AND user_id = $2 LIMIT 1`,
    [callId, userId],
  );
  const role = res.rows[0]?.role;
  return role === "host" || role === "cohost";
}

const emptyResponse = (geminiConfigured: boolean) => ({
  summary: "",
  keyDecisions: [] as string[],
  liveNotes: [] as LiveNote[],
  actionItems: [],
  tasksPipelineStage: "idle" as LocalTasksPipelineStage,
  geminiConfigured,
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isCallDevSttOnlyServer()) {
    return NextResponse.json(
      { error: "Dev STT-only mode — live AI disabled" },
      { status: 503 },
    );
  }

  const { id } = await params;

  try {
    const call = await getCallForMember(id, user.id);
    if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!call.ai_enabled) {
      return NextResponse.json(
        { error: "AI disabled for this call" },
        { status: 400 },
      );
    }

    if (!(await canWriteTranscript(id, user.id, call.created_by))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const mode = parsed.data.mode;
    if (mode === "tasks" && call.status === "live") {
      return NextResponse.json(
        { error: "Task extraction is only available after the call ends" },
        { status: 400 },
      );
    }
    if (mode === "notes" && call.status !== "live") {
      return NextResponse.json({ error: "Call is not live" }, { status: 400 });
    }

    const rate = checkSimpleRateLimit(`call-live-ai:${id}`, 10, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: "Too many live AI requests",
          retryAfterSec: Math.ceil((rate.retryAfterMs ?? 60_000) / 1000),
        },
        { status: 429 },
      );
    }

    const segments = parsed.data.segments as TranscriptSegment[];
    const text = buildTranscriptText(segments, null);
    if (!text.trim()) {
      return NextResponse.json(emptyResponse(isOpenRouterMeetingAiConfigured()));
    }

    if (!isOpenRouterMeetingAiConfigured()) {
      return NextResponse.json(emptyResponse(false));
    }

    const nowMs = call.started_at
      ? Date.now() - new Date(call.started_at).getTime()
      : Date.now();

    if (mode === "notes") {
      const notesResult = await runLiveNotesFromText(text, {
        sinceCharCount: parsed.data.sinceCharCount,
      });

      const liveNotes: LiveNote[] = notesResult.liveNoteBullets.map((t) => ({
        at_ms: nowMs,
        text: t.trim().slice(0, 500),
      }));

      const tasksPipelineStage: LocalTasksPipelineStage =
        text.length > 80 ? "hearing" : "idle";

      return NextResponse.json({
        summary: notesResult.summary,
        keyDecisions: notesResult.keyDecisions,
        liveNotes,
        actionItems: [],
        tasksPipelineStage,
        geminiConfigured: true,
      });
    }

    const slice = transcriptSliceForAi(text, parsed.data.sinceCharCount);
    const { output, liveNoteBullets } =
      await runIncrementalMeetingAiFromText(slice || text);

    const liveNotes: LiveNote[] = liveNoteBullets.map((t) => ({
      at_ms: nowMs,
      text: t.trim().slice(0, 500),
    }));

    let tasksPipelineStage: LocalTasksPipelineStage = "compiling";
    if (output.actionItems.length > 0) tasksPipelineStage = "ready";
    else if (text.length > 80) tasksPipelineStage = "hearing";

    return NextResponse.json({
      summary: output.summary,
      keyDecisions: output.keyDecisions,
      liveNotes,
      actionItems: output.actionItems,
      tasksPipelineStage,
      geminiConfigured: true,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Live AI failed";
    console.error("[live-ai]", id, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
