import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { createWorkspaceMarkdownFile, ensureWorkspaceFolder, sanitizeFileNameSegment } from "@/lib/files/workspaceFileHelpers";
import { checkWorkspaceStorage } from "@/lib/files/storageQuota";

const MEETING_SUMMARY_FOLDER = "Meeting-Summary";

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

  const workspaceId = call.workspace_id;

  const art = await query<{ summary: string | null; status: string }>(
    `SELECT summary, status FROM ${SCHEMA}.call_ai_artifacts
     WHERE call_session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [id],
  );
  const row = art.rows[0];
  const summary = row?.summary?.trim();
  if (!summary || row?.status === "failed") {
    return NextResponse.json(
      { error: "No AI summary available to export yet." },
      { status: 400 },
    );
  }

  const folderId = await ensureWorkspaceFolder(
    workspaceId,
    null,
    MEETING_SUMMARY_FOLDER,
    user.id,
  );

  const ended = call.ended_at ?? call.created_at;
  const dateStr = ended.slice(0, 10);
  const stem = sanitizeFileNameSegment(call.title);

  async function fileNameTaken(name: string): Promise<boolean> {
    const dup = await query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM ${SCHEMA}.workspace_files
         WHERE workspace_id = $1 AND folder_id = $2::uuid AND file_name = $3
       ) AS ok`,
      [workspaceId, folderId, name],
    );
    return !!dup.rows[0]?.ok;
  }

  let fileName = `${stem}-${dateStr}.md`;
  let suffix = 1;
  while (await fileNameTaken(fileName)) {
    suffix += 1;
    fileName = `${stem}-${dateStr}-${suffix}.md`;
  }

  try {
    const created = await createWorkspaceMarkdownFile({
      workspaceId,
      folderId,
      uploadedBy: user.id,
      documentTitle: call.title.trim() || "Meeting",
      body: summary,
      fileName,
    });
    return NextResponse.json(created);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Export failed";
    if (msg === "WORKSPACE_STORAGE_LIMIT") {
      const limitCheck = await checkWorkspaceStorage(workspaceId, 0);
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
}
