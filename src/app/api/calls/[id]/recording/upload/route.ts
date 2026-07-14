import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import {
  resetCallAiForRecordingUpload,
  runCallPostProcessing,
} from "@/lib/calls/callGeminiPostProcess";
import {
  clearProcessingTimer,
  finalizePostCallSkippedStorageLimit,
} from "@/lib/calls/lifecycle";
import {
  PROCESSING_MILESTONES,
  setCallProcessingProgress,
} from "@/lib/calls/processingProgress";
import { checkWorkspaceStorage } from "@/lib/files/storageQuota";
import {
  ensureWorkspaceFolder,
  sanitizeFileNameSegment,
  uploadVideoToWorkspaceFolder,
} from "@/lib/files/workspaceFileHelpers";

export const maxDuration = 300;

const MEETING_RECORDING_FOLDER = "Meeting-Recording";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const call = await getCallForMember(id, user.id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "No recording file" }, { status: 400 });
  }

  const durationRaw = form.get("duration_seconds");
  const durationSeconds =
    typeof durationRaw === "string" ? parseInt(durationRaw, 10) : null;

  const isWebm = file.type.includes("webm");
  const ext = isWebm ? "recording.webm" : "recording.mp4";
  const contentType = file.type || (isWebm ? "video/webm" : "video/mp4");
  const buffer = Buffer.from(await file.arrayBuffer());

  const storageCheck = await checkWorkspaceStorage(
    call.workspace_id,
    buffer.length,
  );
  if (!storageCheck.allowed) {
    await finalizePostCallSkippedStorageLimit(id);
    return NextResponse.json(
      {
        error: storageCheck.error,
        code: storageCheck.code,
      },
      { status: 413 },
    );
  }

  let folderId: string;
  let wf: { id: string; storage_path: string; file_name: string };
  try {
    folderId = await ensureWorkspaceFolder(
      call.workspace_id,
      null,
      MEETING_RECORDING_FOLDER,
      user.id,
    );
    const titleStem = sanitizeFileNameSegment(call.title);
    const displayFileName = `${titleStem}-${ext}`;
    wf = await uploadVideoToWorkspaceFolder({
      workspaceId: call.workspace_id,
      folderId,
      uploadedBy: user.id,
      displayFileName,
      buffer,
      contentType,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    if (msg === "WORKSPACE_STORAGE_LIMIT") {
      await finalizePostCallSkippedStorageLimit(id);
      const limitCheck = await checkWorkspaceStorage(call.workspace_id, 0);
      return NextResponse.json(
        {
          error: limitCheck.error ?? "Workspace storage limit reached.",
          code: "WORKSPACE_STORAGE_LIMIT",
        },
        { status: 413 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const existing = await query<{ id: string }>(
    `SELECT id FROM ${SCHEMA}.call_recordings WHERE call_session_id = $1 LIMIT 1`,
    [id],
  );

  if (existing.rows[0]) {
    await query(
      `UPDATE ${SCHEMA}.call_recordings
       SET storage_key = NULL,
           workspace_file_id = $2,
           status = 'uploaded',
           duration_seconds = COALESCE($3, duration_seconds),
           file_size_bytes = $4,
           updated_at = NOW()
       WHERE call_session_id = $1`,
      [
        id,
        wf.id,
        Number.isFinite(durationSeconds) ? durationSeconds : null,
        buffer.length,
      ],
    );
  } else {
    await query(
      `INSERT INTO ${SCHEMA}.call_recordings
         (call_session_id, workspace_file_id, storage_key, status, duration_seconds, file_size_bytes)
       VALUES ($1, $2, NULL, 'uploaded', $3, $4)`,
      [
        id,
        wf.id,
        Number.isFinite(durationSeconds) ? durationSeconds : null,
        buffer.length,
      ],
    );
  }

  clearProcessingTimer(id);
  await setCallProcessingProgress(id, PROCESSING_MILESTONES.uploadReceived, {
    phase: "waiting_upload",
    stepLabel: "Recording uploaded",
  });
  await resetCallAiForRecordingUpload(id);

  void runCallPostProcessing(id).catch((e: unknown) => {
    console.error("[recording/upload] post-processing failed:", e);
  });

  return NextResponse.json({ ok: true, workspace_file_id: wf.id });
}
