/**
 * InsForge Native SDK client — digunakan untuk OAuth dan auth operations
 * yang tidak bisa dilakukan via @supabase/ssr wrapper.
 *
 * @insforge/sdk handles OAuth redirect, session storage, dan getCurrentUser
 * secara native — termasuk httpOnly refresh cookie management.
 */
import { createClient } from "@insforge/sdk";

const INSFORGE_URL = process.env.NEXT_PUBLIC_INSFORGE_URL!;
const INSFORGE_ANON_KEY = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!;

export const insforgeNative = createClient({
  baseUrl: INSFORGE_URL,
  anonKey: INSFORGE_ANON_KEY,
});
