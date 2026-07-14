"use client";

import { useEffect, useState } from "react";
import type { BillingSummary, PlanCode } from "@/types/billing";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface WorkspaceBillingPlanState {
  planName: string | null;
  planCode: PlanCode | null;
  isLoading: boolean;
}

const EMPTY_STATE: WorkspaceBillingPlanState = {
  planName: null,
  planCode: null,
  isLoading: false,
};

export function useWorkspaceBillingPlan(
  workspaceId: string | null | undefined,
): WorkspaceBillingPlanState {
  const [state, setState] = useState<WorkspaceBillingPlanState>({
    ...EMPTY_STATE,
    isLoading: Boolean(workspaceId),
  });

  useEffect(() => {
    if (!workspaceId) {
      setState(EMPTY_STATE);
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, isLoading: true }));

    authenticatedFetch(`/api/billing/summary?workspaceId=${workspaceId}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { data: BillingSummary } | null) => {
        if (cancelled) return;
        setState({
          planName: json?.data?.plan?.name ?? null,
          planCode: json?.data?.plan?.code ?? "basic",
          isLoading: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState(EMPTY_STATE);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return state;
}
