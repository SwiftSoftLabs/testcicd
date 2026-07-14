import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/** Routes that keep project scope in the `projectId` query param. */
export const PROJECT_SCOPED_PATHS = new Set([
  "/tasks",
  "/calendar",
  "/version-control",
  "/analytics",
  "/vault",
]);

export function projectSelectionStorageKey(workspaceId: string): string {
  return `ow-selected-project-id:${workspaceId}`;
}

/** Align AppContext, localStorage, and project-scoped page URLs (same as sidebar). */
export function applyProjectSelection(opts: {
  projectId: string;
  workspaceId: string | null;
  pathname: string | null;
  router: AppRouterInstance;
  setSelectedProjectId: (projectId: string | null) => void;
}): void {
  opts.setSelectedProjectId(opts.projectId);

  if (opts.workspaceId && typeof window !== "undefined") {
    localStorage.setItem(
      projectSelectionStorageKey(opts.workspaceId),
      opts.projectId,
    );
  }

  if (
    !opts.pathname ||
    !PROJECT_SCOPED_PATHS.has(opts.pathname) ||
    typeof window === "undefined"
  ) {
    return;
  }

  const next = new URLSearchParams(window.location.search);
  if (next.get("projectId") === opts.projectId) return;
  next.set("projectId", opts.projectId);
  opts.router.replace(`${opts.pathname}?${next.toString()}`, { scroll: false });
}
