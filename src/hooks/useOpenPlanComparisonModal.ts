'use client';

import { useCallback } from 'react';
import { useUIContext } from '@/context/UIContext';
import type { BillingPlan } from '@/types/billing';
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface OpenPlanComparisonOptions {
    note: string;
    canManageBilling: boolean;
    currentPlan: string;
}

export function useOpenPlanComparisonModal(workspaceId: string | undefined) {
    const { openModal } = useUIContext();

    return useCallback(
        async (options: OpenPlanComparisonOptions) => {
            if (!workspaceId) return;

            try {
                const res = await authenticatedFetch(`/api/billing/summary?workspaceId=${workspaceId}`);
                const json = res.ok
                    ? (await res.json()) as {
                          data?: {
                              canManage?: boolean;
                              plan?: { code: string };
                              plans?: BillingPlan[];
                          };
                      }
                    : null;

                openModal('plan-comparison', {
                    note: options.note,
                    canManage: json?.data?.canManage ?? options.canManageBilling,
                    currentPlan: json?.data?.plan?.code ?? options.currentPlan,
                    plans: json?.data?.plans ?? [],
                    workspaceId,
                });
            } catch {
                openModal('plan-comparison', {
                    note: options.note,
                    canManage: options.canManageBilling,
                    currentPlan: options.currentPlan,
                    workspaceId,
                });
            }
        },
        [openModal, workspaceId],
    );
}
