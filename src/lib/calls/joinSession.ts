import type { JoinConfig } from "@/components/calls/PreJoinModal";

const PREFIX = "onework-call-join-";
const ACTIVE_CALL_KEY = "onework-active-call-id";
const RETURN_PATH_KEY = "onework-call-return-path";
const PIP_POS_KEY = "onework-call-pip-pos";

export type PipPosition = { x: number; y: number };

export function getActiveCallId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(ACTIVE_CALL_KEY);
}

export function saveActiveCallMeta(callId: string, returnPath: string): void {
  sessionStorage.setItem(ACTIVE_CALL_KEY, callId);
  sessionStorage.setItem(RETURN_PATH_KEY, returnPath);
}

export function loadActiveCallReturnPath(): string {
  if (typeof window === "undefined") return "/dashboard";
  return sessionStorage.getItem(RETURN_PATH_KEY) ?? "/dashboard";
}

export function clearActiveCallMeta(): void {
  sessionStorage.removeItem(ACTIVE_CALL_KEY);
  sessionStorage.removeItem(RETURN_PATH_KEY);
}

export function loadPipPosition(): PipPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PIP_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PipPosition;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePipPosition(pos: PipPosition): void {
  sessionStorage.setItem(PIP_POS_KEY, JSON.stringify(pos));
}

export function callRoomHref(callId: string, fromPath?: string): string {
  const base = `/calls/${callId}/room`;
  if (!fromPath?.trim()) return base;
  return `${base}?from=${encodeURIComponent(fromPath.trim())}`;
}

export function joinSessionKey(callId: string): string {
  return `${PREFIX}${callId}`;
}

export function loadJoinConfig(callId: string): JoinConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(joinSessionKey(callId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<JoinConfig>;
    return {
      videoDeviceId: parsed.videoDeviceId,
      audioDeviceId: parsed.audioDeviceId,
      blurEnabled: parsed.blurEnabled ?? false,
      noiseCancellationEnabled: parsed.noiseCancellationEnabled ?? true,
    };
  } catch {
    return null;
  }
}

export function saveJoinConfig(callId: string, config: JoinConfig): void {
  sessionStorage.setItem(joinSessionKey(callId), JSON.stringify(config));
}

export function clearJoinConfig(callId: string): void {
  sessionStorage.removeItem(joinSessionKey(callId));
}
