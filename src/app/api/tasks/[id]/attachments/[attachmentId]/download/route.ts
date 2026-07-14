import { NextResponse } from "next/server";
import { query, getUserFromRequest, SCHEMA } from "@/lib/db";
import { createClient } from "@insforge/sdk";

const BUCKET = "task-attachments";

const insforge = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
  anonKey: process.env.INSFORGE_API_KEY!,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: taskId, attachmentId } = await params;

  const attRes = await query<{
    storage_path: string;
    file_name: string;
    file_type: string;
  }>(
    `SELECT storage_path, file_name, file_type FROM ${SCHEMA}.task_attachments WHERE id = $1 AND task_id = $2`,
    [attachmentId, taskId],
  );
  const att = attRes.rows[0];
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: blob, error } = await insforge.storage
    .from(BUCKET)
    .download(att.storage_path);
  if (error || !blob) {
    return NextResponse.json(
      { error: "Failed to download file" },
      { status: 500 },
    );
  }

  const asciiName = att.file_name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encodedName = encodeURIComponent(att.file_name);
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const disposition = inline ? "inline" : "attachment";
  return new Response(blob, {
    headers: {
      "Content-Type": att.file_type || "application/octet-stream",
      "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    },
  });
}
