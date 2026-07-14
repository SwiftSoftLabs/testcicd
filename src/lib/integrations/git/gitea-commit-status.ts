import { adminFetch } from "@/lib/integrations/git/gitea-admin";

export type GiteaCommitStatusState =
  | "pending"
  | "success"
  | "failure"
  | "error";

export async function postGiteaCommitStatus(params: {
  owner: string;
  repo: string;
  sha: string;
  state: GiteaCommitStatusState;
  context?: string;
  description?: string;
  targetUrl?: string | null;
}): Promise<void> {
  const e = encodeURIComponent(params.owner);
  const r = encodeURIComponent(params.repo);
  const sha = encodeURIComponent(params.sha);
  const res = await adminFetch(`/repos/${e}/${r}/statuses/${sha}`, {
    method: "POST",
    body: JSON.stringify({
      state: params.state,
      context: params.context ?? "Vercel",
      description: params.description ?? "",
      target_url: params.targetUrl ?? undefined,
    }),
  });
  if (!res.ok && res.status !== 201) {
    const text = await res.text();
    throw new Error(`Failed to post Gitea commit status (${res.status}): ${text}`);
  }
}
