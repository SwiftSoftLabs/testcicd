import { NextResponse } from "next/server";

import { getUserFromRequest } from "@/lib/db";
import { getCalendarIntegrationStatuses } from "@/lib/integrations/calendar/repository";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const integrations = await getCalendarIntegrationStatuses(user.id);
    return NextResponse.json({
      googleConfigured: Boolean(
        process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID?.trim() &&
        process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET?.trim(),
      ),
      zoomConfigured: Boolean(
        process.env.ZOOM_CLIENT_ID?.trim() &&
        process.env.ZOOM_CLIENT_SECRET?.trim(),
      ),
      integrations,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to fetch integration status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
