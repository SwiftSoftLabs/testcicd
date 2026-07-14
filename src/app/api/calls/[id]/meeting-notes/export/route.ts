import { NextResponse } from "next/server";
import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { loadCallMeetingNotes } from "@/lib/calls/meetingNotes";
import {
  createWorkspaceMarkdownFile,
  ensureWorkspaceFolder,
  sanitizeFileNameSegment,
} from "@/lib/files/workspaceFileHelpers";

const USER_MEETING_NOTES_FOLDER = "user-meeting-notes";

function buildExportBody(
  dateStr: string,
  publicContent: string,
  privateContent: string,
): string {
  const pub = publicContent.trim() || "(none)";
  const priv = privateContent.trim() || "(none)";
  return `Date: ${dateStr}\n\n## Public notes\n\n${pub}\n\n## Private notes\n\n${priv}`;
}

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

  const notes = await loadCallMeetingNotes(id, user.id);
  const publicTrim = notes.publicContent.trim();
  const privateTrim = notes.privateContent.trim();

  if (!publicTrim && !privateTrim) {
    return NextResponse.json({ skipped: true, reason: "empty" });
  }

  const workspaceId = call.workspace_id;

  const folderId = await ensureWorkspaceFolder(
    workspaceId,
    null,
    USER_MEETING_NOTES_FOLDER,
    user.id,
  );

  const ended = call.ended_at ?? call.started_at ?? call.created_at;
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

  let fileName = `${stem}-${dateStr}-notes.md`;
  let suffix = 1;
  while (await fileNameTaken(fileName)) {
    suffix += 1;
    fileName = `${stem}-${dateStr}-notes-${suffix}.md`;
  }

  const body = buildExportBody(dateStr, notes.publicContent, notes.privateContent);

  try {
    const created = await createWorkspaceMarkdownFile({
      workspaceId,
      folderId,
      uploadedBy: user.id,
      documentTitle: call.title.trim() || "Meeting notes",
      body,
      fileName,
    });
    return NextResponse.json(created);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Export failed";
    if (msg === "WORKSPACE_STORAGE_LIMIT") {
      return NextResponse.json(
        {
          error: "Workspace storage limit reached (5 GB).",
          code: "WORKSPACE_STORAGE_LIMIT",
        },
        { status: 413 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
