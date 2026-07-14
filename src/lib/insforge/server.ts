import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { INSFORGE_ANON_KEY, INSFORGE_PROXY_URL } from "@/lib/insforge/config";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(INSFORGE_PROXY_URL, INSFORGE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  });
}
