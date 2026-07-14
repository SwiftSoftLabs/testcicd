"use client";

import { useCallback } from "react";
import { useUIContext } from "@/context/UIContext";
import { useAppContext } from "@/context/AppContext";
import type { Project } from "@/types";
import type { BillingSummary } from "@/types/billing";

import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface OpenCreateProjectOptions {
  onCreated?: (project: Project) => void;
}

export function useCreateProjectGuard() {
  const { openModal, addToast } = useUIContext();
  const { projects, selectedWorkspaceId } = useAppContext();

  return useCallback(
    async (options?: OpenCreateProjectOptions) => {
      if (!selectedWorkspaceId) {
        addToast("Select a workspace first.", "error");
        return;
      }

      try {
        const response = await authenticatedFetch(
          `/api/billing/summary?workspaceId=${selectedWorkspaceId}`,
        );
        const json = response.ok
          ? ((await response.json()) as { data: BillingSummary })
          : null;
        const maxProjects = json?.data?.entitlements?.max_projects ?? null;

        if (maxProjects !== null && projects.length >= maxProjects) {
          openModal("plan-comparison", {
            note: "Upgrade to create more projects.",
            canManage: json?.data?.canManage ?? false,
            currentPlan: json?.data?.plan?.code ?? "basic",
            plans: json?.data?.plans ?? [],
            workspaceId: selectedWorkspaceId,
          });
          return;
        }
      } catch {
        // Fail open — a billing fetch issue should not block project creation.
      }

      openModal("new-project", options ? { ...options } : undefined);
    },
    [addToast, openModal, projects.length, selectedWorkspaceId],
  );
}
