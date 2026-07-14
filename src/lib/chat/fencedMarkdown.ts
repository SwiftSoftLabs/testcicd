/** True when the line is exactly ``` with no language tag. */
export function isBareOpeningFence(line: string): boolean {
  return line.trim() === "```";
}

function isMarkdownPreviewOpener(trimmed: string): boolean {
  return trimmed === "```markdown" || trimmed === "```";
}

/** Whether a ```markdown / bare ``` preview block is still open before lineIndex. */
export function isInsideOpenMarkdownPreview(lines: string[], lineIndex: number): boolean {
  let open = false;
  let depth = 0;

  for (let i = 0; i < lineIndex; i++) {
    const trimmed = lines[i].trim();

    if (!open && isMarkdownPreviewOpener(trimmed)) {
      open = true;
      depth = 0;
      continue;
    }

    if (!open) continue;

    if (/^```\S/.test(trimmed)) {
      depth++;
    } else if (/^```\s*$/.test(trimmed)) {
      if (depth > 0) {
        depth--;
      } else {
        open = false;
      }
    }
  }

  return open;
}

function lineIndexAtCursor(text: string, cursor: number): number {
  const before = text.slice(0, cursor);
  return before.split("\n").length - 1;
}

/** True when the line already opens a fenced block (bare, markdown, or named language). */
function isFenceOpenerLine(line: string): boolean {
  return /^```/.test(line.trim());
}

/**
 * When the user finishes typing a new bare ``` fence, expand to ```markdown and move the cursor
 * to the next line. Skips expansion when the line was already a fence opener (e.g. user deleted
 * "markdown" or a language tag to edit it).
 */
export function expandBareFenceAtCursor(
  text: string,
  cursor: number,
  previousText?: string,
): { text: string; cursor: number } | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const lineIndex = lineIndexAtCursor(text, cursor);
  const line = lines[lineIndex] ?? "";

  if (!isBareOpeningFence(line)) return null;
  if (isInsideOpenMarkdownPreview(lines, lineIndex)) return null;

  if (previousText !== undefined) {
    const prevLines = previousText.replace(/\r\n/g, "\n").split("\n");
    const prevLine = prevLines[lineIndex] ?? "";
    if (isFenceOpenerLine(prevLine)) return null;
  }

  const lineStart = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;

  // Only expand once the user has finished the bare fence (cursor at/after ``` on this line).
  const fenceEndOnLine = lineStart + line.trimEnd().length;
  if (cursor < lineStart + 3 || cursor > fenceEndOnLine) return null;

  const before = lines.slice(0, lineIndex).join("\n");
  const after = lines.slice(lineIndex + 1).join("\n");
  const prefix = before.length > 0 ? `${before}\n` : "";
  const suffix = after.length > 0 ? `\n${after}` : "";
  const newText = `${prefix}\`\`\`markdown\n${after.length > 0 ? after : ""}`;
  const newCursor = prefix.length + "```markdown\n".length;

  return { text: newText, cursor: newCursor };
}

/** Replace opening bare ``` lines with ```markdown; leave closing fences and named fences unchanged. */
export function normalizeBareFencesToMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let insidePreview = false;
  let depth = 0;

  const result = lines.map((line) => {
    const trimmed = line.trim();

    if (!insidePreview && trimmed === "```") {
      insidePreview = true;
      depth = 0;
      return "```markdown";
    }

    if (!insidePreview && trimmed === "```markdown") {
      insidePreview = true;
      depth = 0;
      return line;
    }

    if (insidePreview) {
      if (/^```\S/.test(trimmed)) {
        depth++;
      } else if (/^```\s*$/.test(trimmed)) {
        if (depth > 0) {
          depth--;
        } else {
          insidePreview = false;
        }
      }
    }

    return line;
  });

  return result.join("\n");
}
