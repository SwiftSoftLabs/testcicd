export const APP_SETTINGS_STORAGE_KEY = "ow-app-settings";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const DEFAULT_RESOLVED_THEME: ResolvedTheme = "dark";

/** Public auth routes always render with dark semantic tokens. */
export const AUTH_DARK_ROUTE_PREFIXES = [
  "/login",
  "/signup",
  "/verify-email",
  "/auth/",
] as const;

export function isAuthDarkRoute(pathname: string): boolean {
  if (!pathname) {
    return false;
  }
  for (const prefix of AUTH_DARK_ROUTE_PREFIXES) {
    if (prefix.endsWith("/")) {
      if (pathname.startsWith(prefix)) {
        return true;
      }
    } else if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

/** Resolves app theme preference to html class (light | dark). */
export function resolveTheme(
  theme: ThemePreference | undefined,
): ResolvedTheme {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  if (theme === "system" && typeof window !== "undefined") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return DEFAULT_RESOLVED_THEME;
}

/** Auth routes ignore user light preference; dashboard routes use resolveTheme. */
export function resolveThemeForPath(
  theme: ThemePreference | undefined,
  pathname?: string,
): ResolvedTheme {
  if (pathname && isAuthDarkRoute(pathname)) {
    return "dark";
  }
  return resolveTheme(theme);
}

/** Reads theme from localStorage (browser only). Used before React hydration. */
export function readThemeFromStorage(): ResolvedTheme {
  if (typeof window === "undefined") {
    return DEFAULT_RESOLVED_THEME;
  }
  try {
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_RESOLVED_THEME;
    }
    const parsed = JSON.parse(raw) as { theme?: string };
    if (
      parsed.theme === "light" ||
      parsed.theme === "dark" ||
      parsed.theme === "system"
    ) {
      return resolveTheme(parsed.theme);
    }
    return DEFAULT_RESOLVED_THEME;
  } catch {
    return DEFAULT_RESOLVED_THEME;
  }
}

export function applyThemeClass(
  html: HTMLElement,
  theme: ResolvedTheme,
): void {
  html.classList.remove("dark", "light");
  html.classList.add(theme);
}

/**
 * Blocking inline bootstrap for root layout (before paint).
 * Logic must stay aligned with resolveTheme / resolveThemeForPath / isAuthDarkRoute.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var p=location.pathname;var auth=p==="/login"||p.indexOf("/login/")===0||p==="/signup"||p.indexOf("/signup/")===0||p==="/verify-email"||p.indexOf("/verify-email/")===0||p.indexOf("/auth/")===0;if(auth){document.documentElement.classList.remove("dark","light");document.documentElement.classList.add("dark");return;}var k=${JSON.stringify(APP_SETTINGS_STORAGE_KEY)};var s=JSON.parse(localStorage.getItem(k)||"{}");var t=s.theme||"dark";if(t==="system"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.classList.remove("dark","light");document.documentElement.classList.add(t);}catch(e){document.documentElement.classList.add("dark");}})();`;
