const DEFAULT_COOLDOWN_MS = 90_000;

let cooldownUntil = 0;

export class InsforgeRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "InsforgeRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export function markInsforgeRateLimited(cooldownMs = DEFAULT_COOLDOWN_MS): void {
  cooldownUntil = Date.now() + cooldownMs;
}

export function isInsforgeRateLimited(): boolean {
  return Date.now() < cooldownUntil;
}

export function getInsforgeRateLimitRemainingMs(): number {
  return Math.max(0, cooldownUntil - Date.now());
}

export function detectInsforge429(
  status: number,
  message: string,
): boolean {
  if (status === 429) return true;
  const m = message.toLowerCase();
  return (
    m.includes("insforge sql error [429]") ||
    m.includes("too many requests") ||
    m.includes("rate limit")
  );
}
