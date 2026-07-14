import { createGitHubClient } from "./github";
import { createGitLabClient } from "./gitlab";
import { createOneworkClient } from "./onework";
import type { GitProviderClient } from "./provider";
import type { GitProvider } from "@/types/git";

export function getProviderClient(
  provider: GitProvider,
  accessToken: string,
): GitProviderClient {
  if (provider === "github") return createGitHubClient(accessToken);
  if (provider === "onework") return createOneworkClient(accessToken);
  return createGitLabClient(accessToken);
}
