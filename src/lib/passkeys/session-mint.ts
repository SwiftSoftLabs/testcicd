const RAW = process.env.NEXT_PUBLIC_INSFORGE_URL!;
const API_KEY = process.env.INSFORGE_API_KEY!;

export async function mintInsForgeSessionForUser(userId: string) {
  if (!API_KEY) return null;
  let base: string;
  try {
    base = new URL(RAW).origin;
  } catch {
    return null;
  }
  for (const path of ["/api/auth/sessions?client_type=mobile", "/api/auth/sessions"]) {
    for (const body of [{ userId }, { user_id: userId }]) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${API_KEY}`,
            "x-api-key": API_KEY,
          },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          accessToken?: string;
          refreshToken?: string;
          user?: { id: string; email: string; profile?: Record<string, unknown> };
        };
        if (data.accessToken && data.user?.id) {
          return {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken || data.accessToken,
            user: data.user,
          };
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}
