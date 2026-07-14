import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember, isCallHost } from "@/lib/calls/access";
import {
  deleteCallRecordingRow,
  purgeCallRecordingStorage,
} from "@/lib/calls/purgeRecording";

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

  const rec = await query<{
    id: string;
    storage_key: string | null;
    workspace_file_id: string | null;
  }>(
    `SELECT id, storage_key, workspace_file_id FROM ${SCHEMA}.call_recordings
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [id],
  );
  const row = rec.rows[0];
  if (!row) {
    return NextResponse.json({ error: "No recording" }, { status: 404 });
  }

  await purgeCallRecordingStorage(row.workspace_file_id, row.storage_key);
  await deleteCallRecordingRow(row.id);

  return NextResponse.json({ ok: true });
}
