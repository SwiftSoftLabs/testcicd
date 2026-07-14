export interface BillingCustomerKelviqRefs {
    workspace_id: string;
    kelviq_customer_id: string | null;
    kelviq_customer_internal_id: string | null;
}

/** True when kelviq_customer_id stores the workspace UUID external ref (post Phase 2). */
export function isExternalKelviqCustomerRef(
    kelviqCustomerId: string | null,
    workspaceId: string,
): boolean {
    if (!kelviqCustomerId) return false;
    return kelviqCustomerId.toLowerCase() === workspaceId.toLowerCase();
}

/** Kelviq list/subscription API calls use the internal customer UUID (data.id). */
export function getKelviqApiCustomerId(refs: BillingCustomerKelviqRefs): string {
    if (refs.kelviq_customer_internal_id) {
        return refs.kelviq_customer_internal_id;
    }
    if (
        refs.kelviq_customer_id
        && !isExternalKelviqCustomerRef(refs.kelviq_customer_id, refs.workspace_id)
    ) {
        return refs.kelviq_customer_id;
    }
    throw new Error(
        `No Kelviq internal customer id for workspace ${refs.workspace_id}. Run backfill or checkout again.`,
    );
}

/** External ref sent to Kelviq checkout as customerId (workspace UUID). */
export function getKelviqExternalCustomerId(refs: BillingCustomerKelviqRefs): string {
    if (isExternalKelviqCustomerRef(refs.kelviq_customer_id, refs.workspace_id)) {
        return refs.kelviq_customer_id as string;
    }
    return refs.workspace_id;
}
