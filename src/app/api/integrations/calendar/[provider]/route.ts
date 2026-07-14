import { NextResponse } from "next/server";

import { getUserFromRequest } from "@/lib/db";
import { deleteCalendarIntegration } from "@/lib/integrations/calendar/repository";
import type { CalendarIntegrationProvider } from "@/lib/integrations/calendar/oauth";

function parseProvider(raw: string): CalendarIntegrationProvider {
  if (raw === "google") return "google_calendar";
  if (raw === "zoom") return "zoom";
  throw new Error("Unsupported calendar integration provider");
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const provider = parseProvider((await context.params).provider);
    await deleteCalendarIntegration(user.id, provider);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid provider" },
      { status: 400 },
    );
  }
}
