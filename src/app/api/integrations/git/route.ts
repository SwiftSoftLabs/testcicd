import { NextResponse } from "next/server";

import { isOneworkVcConfigured } from "@/lib/integrations/git/onework";
import { getOneworkSshEndpointInfo } from "@/lib/integrations/git/onework-ssh-keys";
import { provisionOneworkForMemberIfNeeded } from "@/lib/integrations/git/provisioning";
import { getStatusForUser } from "@/lib/integrations/git/repository";
import { isWorkspaceMember } from "@/lib/integrations/git/workspace";
import { workspaceIdQuerySchema } from "@/lib/integrations/git/schemas";
import {
  jsonError,
  parseZodError,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    if (!user) return jsonError(401, "Unauthorized");

    const { searchParams } = new URL(request.url);
    const q = workspaceIdQuerySchema.parse(
      Object.fromEntries(searchParams.entries()),
    );

    const allowed = await isWorkspaceMember(q.workspaceId, user.id);
    if (!allowed) return jsonError(404, "Workspace not found or access denied");

    const oneworkVcConfigured = isOneworkVcConfigured();
    let oneworkProvisionError: string | null = null;

    if (oneworkVcConfigured) {
      const provision = await provisionOneworkForMemberIfNeeded({
        workspaceId: q.workspaceId,
        userId: user.id,
      });
      if (!provision.ok && provision.error !== "not_configured") {
        oneworkProvisionError = provision.error;
      }
    }

    const status = await getStatusForUser(q.workspaceId, user.id);
    const oauthGithubConfigured = Boolean(
      process.env.GITHUB_OAUTH_CLIENT_ID?.trim() &&
        process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim(),
    );
    const oauthGitlabConfigured = Boolean(
      process.env.GITLAB_OAUTH_CLIENT_ID?.trim() &&
        process.env.GITLAB_OAUTH_CLIENT_SECRET?.trim(),
    );
    const sshInfo = oneworkVcConfigured ? getOneworkSshEndpointInfo() : null;
    return NextResponse.json({
      ...status,
      oneworkVcConfigured,
      oauthGithubConfigured,
      oauthGitlabConfigured,
      oneworkProvisionError,
      oneworkSshHost: sshInfo?.sshHost ?? null,
      oneworkSshPort: sshInfo?.sshPort ?? null,
    });
  } catch (e: unknown) {
    return jsonError(400, parseZodError(e));
  }
}
