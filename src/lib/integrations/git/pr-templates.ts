import type { GitProviderClient } from "@/lib/integrations/git/provider";

const TEMPLATE_PATHS = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  ".gitea/pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
];

export type PullRequestTemplate = {
  path: string;
  name: string;
  content: string;
};

function templateNameFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "").replace(/_/g, " ");
}

export async function fetchPullRequestTemplates(
  client: GitProviderClient,
  owner: string,
  repo: string,
  defaultBranch?: string,
): Promise<PullRequestTemplate[]> {
  const ref = defaultBranch?.trim() || undefined;
  const templates: PullRequestTemplate[] = [];

  for (const path of TEMPLATE_PATHS) {
    try {
      const file = await client.getFileText(owner, repo, path, ref);
      if (file?.text?.trim()) {
        templates.push({
          path,
          name: templateNameFromPath(path),
          content: file.text,
        });
      }
    } catch {
      // missing template is expected
    }
  }

  return templates;
}
