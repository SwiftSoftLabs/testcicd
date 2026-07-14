import { NextResponse } from "next/server";
import { getUserFromRequest, query, buildSet, SCHEMA } from "@/lib/db";
import { getCallForMember, isCallHost } from "@/lib/calls/access";
import { assertProjectWritable } from "@/lib/billing/quota-locks";
import { toAccessResponse } from "@/lib/rbac/http";
import { patchCallSchema } from "@/lib/calls/schemas";
import { loadCallDetail } from "@/lib/calls/serialize";
import {
  beginCallProcessing,
  stopAgentIfRunning,
} from "@/lib/calls/lifecycle";
import {
  deleteCallRecordingRow,
  purgeCallRecordingStorage,
} from "@/lib/calls/purgeRecording";
import { publishCallSyncUpdate } from "@/lib/calls/realtime-publish";
import type { CallSessionRow } from "@/types/calls";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const call = await getCallForMember(id, user.id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const detail = await loadCallDetail(call);
    return NextResponse.json(detail);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load call";
    const isNetwork =
      msg.includes("fetch failed") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("ECONNRESET") ||
      msg.includes("Connect Timeout");
    return NextResponse.json(
      {
        error: isNetwork ? "Database temporarily unavailable. Try again." : msg,
      },
      { status: isNetwork ? 503 : 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const call = await getCallForMember(id, user.id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const host = await isCallHost(id, user.id);

  if (call.project_id) {
    try {
      await assertProjectWritable(call.project_id as string);
    } catch (e) {
      const access = toAccessResponse(e);
      if (access) return access;
      throw e;
    }
  }

  const body = await request.json();
  const parsed = patchCallSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updates = { ...parsed.data };
  if (
    (updates.status === "cancelled" ||
      updates.status === "processing" ||
      updates.ai_enabled !== undefined) &&
    !host
  ) {
    return NextResponse.json({ error: "Host only" }, { status: 403 });
  }

  if (updates.status === "processing" && call.status === "live") {
    await query(
      `UPDATE ${SCHEMA}.call_participants
       SET left_at = NOW()
       WHERE call_session_id = $1 AND left_at IS NULL`,
      [id],
    );
    await stopAgentIfRunning(call);
    await query(
      `UPDATE ${SCHEMA}.call_sessions
       SET status = 'processing',
           ended_at = COALESCE(ended_at, NOW()),
           metadata = metadata || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        id,
        JSON.stringify({
          processing_started_at: new Date().toISOString(),
          processing_phase: "ending",
          processing_progress: 8,
          processing_step_label: "Call ended",
        }),
      ],
    );
    void beginCallProcessing(id).catch((e: unknown) => {
      console.error("[calls PATCH] beginCallProcessing", id, e);
    });
    void publishCallSyncUpdate(id).catch(() => undefined);
    return NextResponse.json({
      ok: true,
      status: "processing",
    });
  }

  if (updates.status === "cancelled") {
    await stopAgentIfRunning(call);
    updates.status = "cancelled";
  }

  const {
    clause,
    params: setParams,
    nextIdx,
  } = buildSet({
    ...updates,
    updated_at: new Date().toISOString(),
  });
  if (!clause) {
    return NextResponse.json(call);
  }

  await query(
    `UPDATE ${SCHEMA}.call_sessions SET ${clause}, updated_at = NOW() WHERE id = $${nextIdx}`,
    [...setParams, id],
  );

  const updated = await getCallForMember(id, user.id);
  if (
    updates.status === "cancelled" ||
    updates.status === "processing"
  ) {
    void publishCallSyncUpdate(id).catch(() => undefined);
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const call = await getCallForMember(id, user.id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!(await isCallHost(id, user.id))) {
    return NextResponse.json({ error: "Host only" }, { status: 403 });
  }

  const recRows = await query<{
    id: string;
    workspace_file_id: string | null;
    storage_key: string | null;
  }>(
    `SELECT id, workspace_file_id, storage_key FROM ${SCHEMA}.call_recordings
     WHERE call_session_id = $1`,
    [id],
  );
  for (const r of recRows.rows) {
    await purgeCallRecordingStorage(r.workspace_file_id, r.storage_key);
    await deleteCallRecordingRow(r.id);
  }

  await query(
    `DELETE FROM ${SCHEMA}.tasks t
     USING ${SCHEMA}.meeting_task_reviews mtr
     WHERE t.id = mtr.task_id
       AND mtr.call_session_id = $1
       AND mtr.review_status = 'pending'`,
    [id],
  );

  await query(
    `UPDATE ${SCHEMA}.tasks SET source_call_id = NULL WHERE source_call_id = $1`,
    [id],
  );

  await query(`DELETE FROM ${SCHEMA}.call_sessions WHERE id = $1`, [id]);

  return NextResponse.json({ ok: true });
}
