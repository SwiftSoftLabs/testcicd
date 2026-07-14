export function buildOneworkPullShareUrl(
  projectId: string,
  pullNumber: number,
): string {
  const params = new URLSearchParams({ projectId });
  return `/version-control/pulls/${pullNumber}?${params.toString()}`;
}

export function buildOneworkCommitShareUrl(
  projectId: string,
  sha: string,
): string {
  const params = new URLSearchParams({ projectId });
  return `/version-control/commits/${encodeURIComponent(sha)}?${params.toString()}`;
}

export function buildVersionControlProjectUrl(projectId: string): string {
  const params = new URLSearchParams({ projectId });
  return `/version-control?${params.toString()}`;
}
