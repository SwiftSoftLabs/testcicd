import { getWorkspaceSubscription } from "@/lib/billing/subscription";
import type { AiTier } from "@/types/billing";

const ASSISTANT_ALLOWED_TIERS: ReadonlySet<AiTier> = new Set([
  "task_intel",
  "full_suite",
  "dedicated",
]);

export async function assertAssistantAiTier(
  workspaceId: string | null | undefined,
): Promise<{ allowed: boolean; tier: AiTier; message?: string }> {
  if (!workspaceId?.trim()) {
    return {
      allowed: false,
      tier: "none",
      message: "Select a workspace to use the voice assistant.",
    };
  }
  const { plan } = await getWorkspaceSubscription(workspaceId.trim());
  const tier = plan.ai_tier;
  if (!ASSISTANT_ALLOWED_TIERS.has(tier)) {
    return {
      allowed: false,
      tier,
      message:
        "Voice assistant requires a plan with AI features (Task Intel or higher).",
    };
  }
  return { allowed: true, tier };
}
