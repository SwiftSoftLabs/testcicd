import { createClient } from "@insforge/sdk";
import { loadCallLivePayload } from "@/lib/calls/liveSession";
import { loadCallSync } from "@/lib/calls/serialize";
import { getCallSession } from "@/lib/calls/access";
import type {
  CallLivePayload,
  CallNotesUpdatePayload,
  CallSyncPayload,
} from "@/types/calls";

const insforge = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
  anonKey: process.env.INSFORGE_API_KEY!,
});

export type CallRealtimeEvent =
  | "CALL_LIVE_UPDATE"
  | "CALL_SYNC_UPDATE"
  | "CALL_NOTES_UPDATE";

async function ensureConnected(): Promise<boolean> {
  try {
    if (!insforge.realtime.isConnected) {
      await insforge.realtime.connect();
    }
    return insforge.realtime.isConnected;
  } catch {
    return false;
  }
}

export async function publishCallEvent(
  callId: string,
  event: CallRealtimeEvent,
  payload: CallLivePayload | CallSyncPayload | CallNotesUpdatePayload,
): Promise<void> {
  try {
    if (!(await ensureConnected())) return;
    await insforge.realtime.publish(
      `call:${callId}`,
      event,
      payload as unknown as Record<string, unknown>,
    );
  } catch (err) {
    console.error("[calls/realtime-publish]", event, callId, err);
  }
}

export async function publishCallLiveUpdate(
  callId: string,
  metadata: Record<string, unknown>,
  callAiEnabled: boolean,
  agentDispatchId?: string | null,
): Promise<void> {
  const payload = await loadCallLivePayload(callId, metadata, callAiEnabled, {
    includeTranscript: false,
    agentDispatchId,
  });
  await publishCallEvent(callId, "CALL_LIVE_UPDATE", payload);
}

export async function publishCallSyncUpdate(callId: string): Promise<void> {
  const call = await getCallSession(callId);
  if (!call) return;
  const sync = await loadCallSync(call);
  await publishCallEvent(callId, "CALL_SYNC_UPDATE", sync);
}

export async function publishCallNotesUpdate(
  callId: string,
  payload: CallNotesUpdatePayload,
): Promise<void> {
  await publishCallEvent(callId, "CALL_NOTES_UPDATE", payload);
}
