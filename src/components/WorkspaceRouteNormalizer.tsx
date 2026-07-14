"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAppContext } from "@/context/AppContext";
import { getRouteAfterWorkspaceSwitch } from "@/lib/navigation/workspaceSwitch";

export default function WorkspaceRouteNormalizer() {
  const { selectedWorkspaceId } = useAppContext();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const previousWorkspaceIdRef = useRef<string | null>(null);
  const pendingWorkspaceSwitchRef = useRef(false);

  useEffect(() => {
    const previousWorkspaceId = previousWorkspaceIdRef.current;
    previousWorkspaceIdRef.current = selectedWorkspaceId;

    if (
      previousWorkspaceId &&
      selectedWorkspaceId &&
      previousWorkspaceId !== selectedWorkspaceId
    ) {
      pendingWorkspaceSwitchRef.current = true;
    }

    if (!pendingWorkspaceSwitchRef.current) {
      return;
    }

    const nextRoute = getRouteAfterWorkspaceSwitch(pathname);
    if (nextRoute) {
      router.replace(nextRoute, { scroll: false });
      return;
    }

    pendingWorkspaceSwitchRef.current = false;
  }, [pathname, router, searchParams, selectedWorkspaceId]);

  return null;
}
