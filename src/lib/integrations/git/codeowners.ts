export type CodeownersEntry = {
  pattern: string;
  owners: string[];
};

/** Minimal CODEOWNERS parser (path pattern → @owners). */
export function parseCodeowners(content: string): CodeownersEntry[] {
  const entries: CodeownersEntry[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const pattern = parts[0]!;
    const owners = parts
      .slice(1)
      .map((o) => o.replace(/^@/, "").trim())
      .filter(Boolean);
    if (owners.length > 0) entries.push({ pattern, owners });
  }
  return entries;
}

function patternMatches(path: string, pattern: string): boolean {
  if (pattern === "*" || pattern === "**") return true;
  const normalized = path.replace(/^\//, "");
  if (pattern.endsWith("/")) {
    return normalized.startsWith(pattern.replace(/^\//, ""));
  }
  if (pattern.includes("*")) {
    const re = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
    return re.test(normalized);
  }
  return normalized === pattern.replace(/^\//, "") || normalized.endsWith(`/${pattern}`);
}

export function ownersForChangedFiles(
  entries: CodeownersEntry[],
  filenames: string[],
): string[] {
  const owners = new Set<string>();
  for (const file of filenames) {
    for (const entry of [...entries].reverse()) {
      if (patternMatches(file, entry.pattern)) {
        for (const o of entry.owners) owners.add(o);
        break;
      }
    }
  }
  return [...owners];
}

export const CODEOWNERS_PATHS = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
  ".gitea/CODEOWNERS",
];
