import type { GitProvider } from "@/types/git";

import { IntegrationNotFoundError } from "./errors";
import { isOneworkVcConfigured } from "./onework";
import type { GitProviderClient } from "./provider";
import { provisionOneworkForMemberIfNeeded } from "./provisioning";
import { getProviderClient } from "./registry";
import {
  bumpLastUsed,
  findIntegration,
  getAccessTokenForIntegration,
} from "./repository";

export async function getGitClientForUser(
  workspaceId: string,
  userId: string,
  provider: GitProvider,
): Promise<GitProviderClient> {
  if (provider === "onework" && isOneworkVcConfigured()) {
    await provisionOneworkForMemberIfNeeded({ workspaceId, userId });
    const row = await findIntegration(workspaceId, userId, provider);
    if (!row || row.status !== "connected") {
      throw new IntegrationNotFoundError(
        "OneWork Version Control is still being set up for this workspace",
      );
    }
    const token = await getAccessTokenForIntegration(row);
    void bumpLastUsed(row.id);
    return getProviderClient(provider, token);
  }

  const row = await findIntegration(workspaceId, userId, provider);
  if (!row || row.status !== "connected") {
    throw new IntegrationNotFoundError(
      "Connect this provider in Integrations first",
    );
  }
  const token = await getAccessTokenForIntegration(row);
  void bumpLastUsed(row.id);
  return getProviderClient(provider, token);
}
