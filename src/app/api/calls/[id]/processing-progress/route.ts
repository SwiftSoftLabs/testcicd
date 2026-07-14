import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import {
  uploadProgressPercent,
  setCallProcessingProgress,
} from "@/lib/calls/processingProgress";

const bodySchema = z.object({
  progress: z.number().min(0).max(100).optional(),
  upload_ratio: z.number().min(0).max(1).optional(),
});

async function canUpdateProgress(
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

export async function PATCH(
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

    if (!(await canUpdateProgress(id, user.id, call.created_by))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!["processing", "live"].includes(call.status)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const rec = await query<{ status: string }>(
      `SELECT status FROM ${SCHEMA}.call_recordings
       WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    const recStatus = rec.rows[0]?.status;
    if (recStatus !== "recording" && recStatus !== undefined) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    let percent: number;
    if (parsed.data.upload_ratio != null) {
      percent = uploadProgressPercent(parsed.data.upload_ratio);
    } else if (parsed.data.progress != null) {
      percent = parsed.data.progress;
    } else {
      return NextResponse.json({ error: "progress or upload_ratio required" }, {
        status: 400,
      });
    }

    await setCallProcessingProgress(id, percent, {
      phase: "waiting_upload",
      stepLabel: "Uploading recording",
    });

    return NextResponse.json({ ok: true, progress: percent });
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? e.message : "Failed to update processing progress";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
