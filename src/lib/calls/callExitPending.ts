const PREFIX = "call_exit_pending_";

export function setCallExitPending(callId: string): void {
  try {
    sessionStorage.setItem(`${PREFIX}${callId}`, String(Date.now()));
  } catch {
    /* private mode */
  }
}

export function clearCallExitPending(callId: string): void {
  try {
    sessionStorage.removeItem(`${PREFIX}${callId}`);
  } catch {
    /* ignore */
  }
}

export function isCallExitPending(callId: string): boolean {
  try {
    return sessionStorage.getItem(`${PREFIX}${callId}`) != null;
  } catch {
    return false;
  }
}

/** Local floor percent while server may still show live. */
export function callExitPendingFloorPercent(callId: string): number {
  if (!isCallExitPending(callId)) return 0;
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${callId}`);
    if (!raw) return 3;
    const age = Date.now() - parseInt(raw, 10);
    if (age > 60_000) return 0;
    return age < 5_000 ? 5 : 8;
  } catch {
    return 5;
  }
}
