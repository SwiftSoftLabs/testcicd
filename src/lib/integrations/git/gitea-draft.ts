/** Gitea draft PRs are WIP-titled; create/update APIs ignore a `draft` field (through 1.22.x). */
const GITEA_WIP_PREFIXES = ["WIP:", "[WIP]", "Draft:", "[Draft]"] as const;

export const GITEA_DEFAULT_WIP_PREFIX = "WIP:";

export function titleHasGiteaDraftPrefix(title: string): boolean {
  const upper = title.trimStart().toUpperCase();
  return GITEA_WIP_PREFIXES.some((prefix) =>
    upper.startsWith(prefix.toUpperCase()),
  );
}

export function applyGiteaDraftPrefix(title: string): string {
  const trimmed = title.trim();
  if (!trimmed || titleHasGiteaDraftPrefix(trimmed)) return trimmed;
  return `${GITEA_DEFAULT_WIP_PREFIX} ${trimmed}`;
}

export function stripGiteaDraftPrefix(title: string): string {
  const trimmed = title.trimStart();
  for (const prefix of GITEA_WIP_PREFIXES) {
    if (trimmed.toUpperCase().startsWith(prefix.toUpperCase())) {
      return trimmed.slice(prefix.length).trimStart();
    }
  }
  return title;
}

export function displayGiteaPullTitle(title: string, isDraft: boolean): string {
  if (!isDraft) return title;
  return stripGiteaDraftPrefix(title);
}
