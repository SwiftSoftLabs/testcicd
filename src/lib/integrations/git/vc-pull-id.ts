/**
 * Stable PR identifiers for VC UI (handles nested repo paths safely).
 */
import type { GitProvider } from "@/types/git";

const SEP = "\u001e";

export function buildVcPullId(
  provider: GitProvider,
  fullName: string,
  pullNumber: number,
): string {
  return `pr${SEP}${provider}${SEP}${fullName}${SEP}${pullNumber}`;
}

export function parseVcPullId(id: string): {
  provider: GitProvider;
  fullName: string;
  number: number;
} | null {
  const parts = id.split(SEP);
  if (parts.length !== 4 || parts[0] !== "pr") return null;
  const provider = parts[1];
  const fullName = parts[2];
  const num = Number(parts[3]);
  if (provider !== "github" && provider !== "gitlab" && provider !== "onework") return null;
  if (!fullName || !Number.isFinite(num) || num < 1) return null;
  return { provider, fullName, number: num };
}
