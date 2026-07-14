import { createBrowserClient } from "@supabase/ssr";
import { INSFORGE_ANON_KEY, INSFORGE_PROXY_URL } from "@/lib/insforge/config";

export function createClient() {
  return createBrowserClient(INSFORGE_PROXY_URL, INSFORGE_ANON_KEY);
}
