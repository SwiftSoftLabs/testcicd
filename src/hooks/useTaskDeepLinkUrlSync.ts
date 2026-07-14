"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useTaskDeepLinkUrlSync(
  taskId: string,
  projectId?: string | null,
) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();

  const clearOpenParam = useCallback(() => {
    if (pathname !== "/tasks") return;

    const next = new URLSearchParams(searchParamsString);
    if (!next.has("open")) return;

    next.delete("open");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParamsString]);

  useEffect(() => {
    if (pathname !== "/tasks") return;

    const next = new URLSearchParams(searchParamsString);
    let changed = false;

    if (next.get("open") !== taskId) {
      next.set("open", taskId);
      changed = true;
    }

    if (projectId && next.get("projectId") !== projectId) {
      next.set("projectId", projectId);
      changed = true;
    }

    if (!changed) return;

    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, projectId, router, searchParamsString, taskId]);

  return { clearOpenParam };
}
