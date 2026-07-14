import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { flushCallTranscriptToDb } from "@/lib/calls/flushLocalTranscript";
import type { LiveNote, TranscriptSegment } from "@/types/calls";

const segmentSchema = z.object({
  text: z.string(),
  start_ms: z.number().int().min(0),
  end_ms: z.number().int().min(0),
  speaker_user_id: z.union([z.string().uuid(), z.null()]).optional(),
  participant_identity: z.string().nullable().optional(),
  is_final: z.boolean().optional(),
  sentence_id: z.number().int().nullable().optional(),
});

const liveNoteSchema = z.object({
  at_ms: z.number(),
  text: z.string(),
});

const pendingTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  suggestedAssigneeId: z.string().uuid().nullable().optional(),
  suggestedPriority: z
    .enum(["urgent", "high", "medium", "low"])
    .optional(),
  suggestedDueDate: z.string().nullable().optional(),
  confidence: z.number().optional(),
  localId: z.string().optional(),
});

const bodySchema = z.object({
  segments: z.array(segmentSchema).max(5000),
  summary: z.string().nullable().optional(),
  keyDecisions: z.array(z.string()).optional(),
  liveNotes: z.array(liveNoteSchema).optional(),
  pendingTasks: z.array(pendingTaskSchema).optional(),
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const call = await getCallForMember(id, user.id);
    if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

    const segments = parsed.data.segments as TranscriptSegment[];
    const pendingTasks = (parsed.data.pendingTasks ?? []).map(
      ({ localId: _localId, ...task }) => task,
    );

    const result = await flushCallTranscriptToDb(
      call,
      segments,
      {
        summary: parsed.data.summary ?? null,
        keyDecisions: parsed.data.keyDecisions ?? [],
        liveNotes: (parsed.data.liveNotes ?? []) as LiveNote[],
        pendingTasks,
      },
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to flush transcript";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
