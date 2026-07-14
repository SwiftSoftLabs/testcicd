import "server-only";

import { AgentDispatchClient } from "livekit-server-sdk";
import {
  liveKitAgentName,
  liveKitApiKey,
  liveKitApiSecret,
  liveKitServerUrl,
} from "./config";

function dispatchClient(): AgentDispatchClient {
  return new AgentDispatchClient(
    liveKitServerUrl(),
    liveKitApiKey(),
    liveKitApiSecret(),
  );
}

export async function startLiveKitAgent(
  roomName: string,
  metadata: { call_id: string; workspace_id: string },
): Promise<string> {
  const client = dispatchClient();
  const dispatch = await client.createDispatch(
    roomName,
    liveKitAgentName(),
    { metadata: JSON.stringify(metadata) },
  );
  return dispatch.id;
}

export async function stopLiveKitAgent(
  dispatchId: string,
  roomName: string,
): Promise<void> {
  const client = dispatchClient();
  try {
    await client.deleteDispatch(dispatchId, roomName);
  } catch {
    /* best effort */
  }
}
