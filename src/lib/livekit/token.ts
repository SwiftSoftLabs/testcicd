import { AccessToken } from "livekit-server-sdk";
import { CALL_TOKEN_EXPIRE_SECONDS } from "@/lib/calls/constants";
import { liveKitApiKey, liveKitApiSecret, liveKitPublicUrl } from "./config";

export interface LiveKitTokenInput {
  roomName: string;
  identity: string;
  name?: string | null;
  metadata?: Record<string, string>;
}

export interface LiveKitTokenResult {
  token: string;
  url: string;
  room: string;
  identity: string;
}

export async function buildLiveKitToken(
  input: LiveKitTokenInput,
): Promise<LiveKitTokenResult> {
  const at = new AccessToken(liveKitApiKey(), liveKitApiSecret(), {
    identity: input.identity,
    name: input.name?.trim() || input.identity,
    ttl: CALL_TOKEN_EXPIRE_SECONDS,
    metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
  });

  at.addGrant({
    roomJoin: true,
    room: input.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return {
    token: await at.toJwt(),
    url: liveKitPublicUrl(),
    room: input.roomName,
    identity: input.identity,
  };
}
