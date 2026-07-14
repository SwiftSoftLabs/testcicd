import { createClient } from "@/lib/insforge/server";

export async function checkMembership(workspaceId: string) {
  const insforge = await createClient();
  const {
    data: { user },
  } = await insforge.auth.getUser();

  if (!user) return { error: "No user" };

  const { data: membership, error } = await insforge
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id);

  return { user, membership, error };
}
