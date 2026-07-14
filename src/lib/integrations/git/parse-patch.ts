import type { DiffFile, DiffLine } from "@/types";

const LINE_REGEX = /^([+ ])(.*)$/;

/** Split a multi-file unified diff into per-file patches keyed by path. */
export function splitUnifiedDiffByFile(diffText: string): Map<string, string> {
  const map = new Map<string, string>();
  const trimmed = diffText.trim();
  if (!trimmed) return map;

  const chunks = trimmed.split(/\n(?=diff --git )/);
  for (const chunk of chunks) {
    const body = chunk.trim();
    if (!body.startsWith("diff --git ")) continue;
    const header = body.split("\n")[0] ?? "";
    const m = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
    const filename = (m?.[2] ?? m?.[1] ?? "").replace(/^"|"$/g, "");
    if (filename) map.set(filename, body);
  }
  return map;
}

export function mapGiteaFileStatus(
  status: string | undefined,
): DiffFile["status"] {
  const s = (status ?? "").toLowerCase();
  if (s === "added") return "added";
  if (s === "removed" || s === "deleted") return "removed";
  return "modified";
}

export type UnifiedPatchToDiffFileOpts = {
  status?: DiffFile["status"];
  additions?: number;
  deletions?: number;
};

/**
 * Parses a unified diff patch fragment into DiffLine rows for UI display.
 * Falls back to a single normal line if the patch is missing or unparseable.
 */
export function unifiedPatchToDiffFile(
  filename: string,
  patch: string | undefined,
  opts?: UnifiedPatchToDiffFileOpts,
): DiffFile {
  if (!patch?.trim()) {
    return {
      filename,
      status: opts?.status ?? "modified",
      additions: opts?.additions ?? 0,
      deletions: opts?.deletions ?? 0,
      lines: [
        {
          number: 1,
          content: "(No diff available)",
          type: "normal",
          comments: [],
        },
      ],
    };
  }

  const rawLines = patch.split("\n");
  const lines: DiffLine[] = [];
  let lineNo = 0;
  let additions = 0;
  let deletions = 0;

  for (const raw of rawLines) {
    if (
      raw.startsWith("+++") ||
      raw.startsWith("---") ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ")
    ) {
      continue;
    }
    if (raw.startsWith("@@")) {
      lineNo += 1;
      lines.push({
        number: lineNo,
        content: raw,
        type: "normal",
        comments: [],
      });
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      additions += 1;
      lineNo += 1;
      lines.push({
        number: lineNo,
        content: raw.slice(1),
        type: "addition",
        comments: [],
      });
      continue;
    }
    if (raw.startsWith("-") && !raw.startsWith("---")) {
      deletions += 1;
      lineNo += 1;
      lines.push({
        number: lineNo,
        content: raw.slice(1),
        type: "deletion",
        comments: [],
      });
      continue;
    }
    const m = raw.match(LINE_REGEX);
    if (m) {
      lineNo += 1;
      lines.push({
        number: lineNo,
        content: m[2] ?? "",
        type: "normal",
        comments: [],
      });
      continue;
    }
    lineNo += 1;
    lines.push({ number: lineNo, content: raw, type: "normal", comments: [] });
  }

  if (lines.length === 0) {
    lines.push({
      number: 1,
      content: "(Empty patch)",
      type: "normal",
      comments: [],
    });
  }

  return {
    filename,
    status: opts?.status ?? "modified",
    additions: opts?.additions ?? additions,
    deletions: opts?.deletions ?? deletions,
    lines,
  };
}
