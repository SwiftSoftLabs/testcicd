import type {
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
} from "livekit-client";

/** Preserves LiveKit Room state across LiveKitCallRoom layout remounts (pip ↔ full). */
export type PersistedLiveKitRtcState = {
  callId: string;
  room: Room;
  roomConnected: boolean;
  audioTrack: LocalAudioTrack | null;
  rawVideoTrack: LocalVideoTrack | null;
  publishedVideo: LocalVideoTrack | null;
  blurCleanup: (() => void) | null;
  blurReconnect: ((sourceMST: MediaStreamTrack) => Promise<void>) | null;
  remoteIdentities: string[];
  isScreenSharing: boolean;
};

let persistedLiveKit: PersistedLiveKitRtcState | null = null;

export function clearPersistedRtc(callId?: string): void {
  if (!callId || persistedLiveKit?.callId === callId) {
    persistedLiveKit = null;
  }
}

export function persistLiveKitRtcState(state: PersistedLiveKitRtcState): void {
  persistedLiveKit = state;
}

export function takePersistedLiveKitRtc(
  callId: string,
): PersistedLiveKitRtcState | null {
  if (!persistedLiveKit || persistedLiveKit.callId !== callId) return null;
  const snap = persistedLiveKit;
  persistedLiveKit = null;
  return snap;
}

export function hasPersistedLiveKitRtc(callId: string): boolean {
  return persistedLiveKit?.callId === callId;
}
