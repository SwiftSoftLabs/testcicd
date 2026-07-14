/**
 * GitHub REST errors are JSON: { "message": "...", "documentation_url": "..." }.
 * Normalize to a single human-readable line for UpstreamError / API responses.
 */
export function parseGitHubJsonErrorBody(bodyText: string): string {
  const raw = bodyText.trim();
  if (!raw) return "Request failed";

  try {
    const o = JSON.parse(raw) as {
      message?: string;
      errors?: Array<{ message?: string; code?: string }>;
    };
    if (typeof o.message === "string" && o.message.length > 0) {
      if (Array.isArray(o.errors) && o.errors.length > 0) {
        const parts = o.errors
          .map((e) => (typeof e.message === "string" ? e.message : null))
          .filter(Boolean) as string[];
        if (parts.length) return `${o.message} (${parts.join("; ")})`;
      }
      return o.message;
    }
  } catch {
    /* body is not JSON */
  }

  return raw.length > 400 ? `${raw.slice(0, 380)}…` : raw;
}
