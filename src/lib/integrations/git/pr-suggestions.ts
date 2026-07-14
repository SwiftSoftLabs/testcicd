/** Extract GitHub-style suggestion blocks from review comment bodies. */
export function extractSuggestionBlocks(body: string): Array<{
  path: string;
  suggestion: string;
}> {
  const blocks: Array<{ path: string; suggestion: string }> = [];
  const re =
    /```suggestion\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    blocks.push({ path: "", suggestion: match[1]?.trim() ?? "" });
  }
  return blocks;
}

export function commentHasSuggestions(body: string): boolean {
  return body.includes("```suggestion");
}
