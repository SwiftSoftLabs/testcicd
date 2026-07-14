import { NextResponse } from "next/server";

import {
  handleVercelDeploymentWebhook,
  verifyVercelWebhookSignature,
} from "@/lib/integrations/git/vercel-cicd";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-vercel-signature");

  try {
    if (!verifyVercelWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } catch (e) {
    console.error("[vercel webhooks] signature config error", e);
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType =
    request.headers.get("x-vercel-event") ??
    (typeof payload.type === "string" ? payload.type : "unknown");

  try {
    await handleVercelDeploymentWebhook(eventType, payload);
  } catch (e) {
    console.error("[vercel webhooks]", e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
