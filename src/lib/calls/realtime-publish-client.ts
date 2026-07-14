"use client";

import { insforgeNative } from "@/lib/insforge/native";
import type { CallLivePayload } from "@/types/calls";
/** Best-effort browser publish so in-call clients receive AI updates without polling. */
export async function publishCallLiveUpdateClient(
  callId: string,
  payload: CallLivePayload,
): Promise<void> {
  try {
    if (!insforgeNative.realtime.isConnected) {
      await insforgeNative.realtime.connect();
    }
    await insforgeNative.realtime.publish(
      `call:${callId}`,
      "CALL_LIVE_UPDATE",
      payload as unknown as Record<string, unknown>,
    );
  } catch (err) {
    console.warn("[calls/realtime-publish-client]", err);
  }
}
