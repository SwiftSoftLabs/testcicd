import { requireMfaStepUp } from "@/lib/mfa/guard";
import { requireSessionUser } from "@/lib/rbac/workspace-access";

export async function requireVaultApiUser(request: Request) {
  const user = await requireSessionUser(request);
  await requireMfaStepUp(request, user.id);
  return user;
}
