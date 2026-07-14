/** Fast HTML → plain text for previews and heuristics (not security sanitization). */
export function stripHtmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
