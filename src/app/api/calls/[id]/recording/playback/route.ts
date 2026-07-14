import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/db";
import { getCallForMember } from "@/lib/calls/access";
import { playbackContentType } from "@/lib/calls/localRecording";
import { downloadCallRecordingBlob } from "@/lib/calls/storage";

function byteRange(
  size: number,
  rangeHeader: string | null,
): { start: number; end: number; isPartial: boolean } {
  if (!rangeHeader?.startsWith("bytes=")) {
    return { start: 0, end: size - 1, isPartial: false };
  }
  const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
  const start = Number.parseInt(startStr, 10);
  const end = endStr ? Number.parseInt(endStr, 10) : size - 1;
  if (!Number.isFinite(start) || start < 0 || start >= size) {
    return { start: 0, end: size - 1, isPartial: false };
  }
  return {
    start,
    end: Number.isFinite(end) ? Math.min(end, size - 1) : size - 1,
    isPartial: true,
  };
}

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

  const { blob, pathForMime, storedFileType } =
    await downloadCallRecordingBlob(id);

  if (!blob || blob.size === 0) {
    return NextResponse.json(
      { error: "No recording" },
      { status: 404 },
    );
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const contentType = playbackContentType(
    pathForMime,
    storedFileType,
    blob.type,
  );
  const { start, end, isPartial } = byteRange(
    bytes.length,
    request.headers.get("range"),
  );
  const slice = bytes.subarray(start, end + 1);

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Length": String(slice.length),
  };

  if (isPartial) {
    headers["Content-Range"] = `bytes ${start}-${end}/${bytes.length}`;
    return new NextResponse(slice, { status: 206, headers });
  }

  return new NextResponse(slice, { status: 200, headers });
}
