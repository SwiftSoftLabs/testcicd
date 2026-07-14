import { NextResponse } from "next/server";

/** Per-segment persistence is deprecated; clients flush on leave/end via /transcript/flush. */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Per-segment transcript writes are disabled. Flush transcript on leave or end call.",
    },
    { status: 410 },
  );
}
