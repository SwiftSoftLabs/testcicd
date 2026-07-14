export function getRouteAfterWorkspaceSwitch(
  pathname: string | null,
): string | null {
  if (!pathname) return null;
  if (pathname === "/" || pathname === "/dashboard") return null;
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return null;
  if (pathname === "/email" || pathname.startsWith("/email/")) return null;
  if (pathname === "/settings" || pathname.startsWith("/settings/"))
    return null;
  if (pathname === "/vault" || pathname.startsWith("/vault/")) return null;
  return "/dashboard";
}
