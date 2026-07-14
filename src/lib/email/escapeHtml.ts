/** Escape text for safe insertion into HTML (e.g. plain-text fallback bodies). */
export function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape text, preserve newlines as &lt;br/&gt;, wrap bare URLs in anchors (for text-only mail). */
export function plainTextToMinimalHtml(text: string): string {
  const esc = escapeHtmlText(text.trim());
  const withBr = esc.replace(/\r\n|\n|\r/g, "<br/>");
  return withBr.replace(/\b(https?:\/\/[^\s<]+)/gi, (url) => {
    const safe = encodeURI(url);
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}
