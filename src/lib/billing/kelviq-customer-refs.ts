import { query, SCHEMA } from '@/lib/db';
import {
    fetchCustomerByWorkspaceId,
    fetchKelviqCustomerByInternalId,
} from '@/lib/integrations/kelviq/client';

const WORKSPACE_UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type { BillingCustomerKelviqRefs } from './kelviq-customer-id-helpers';
export {
    getKelviqApiCustomerId,
    getKelviqExternalCustomerId,
    isExternalKelviqCustomerRef,
} from './kelviq-customer-id-helpers';

export async function resolveWorkspaceIdFromCustomerRef(
    customerRef: string,
): Promise<string | null> {
    const ref = customerRef.trim();
    if (!ref) return null;
    const result = await query<{ workspace_id: string }>(
        `SELECT workspace_id FROM ${SCHEMA}.billing_customers
         WHERE kelviq_customer_internal_id = $1
            OR kelviq_customer_id = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
        [ref],
    );
    return result.rows[0]?.workspace_id ?? null;
}

const WORKSPACE_ID_FROM_URL_RE =
    /[?&]workspaceId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Parse workspaceId from Kelviq checkout success/cancel/referer URLs. */
export function extractWorkspaceIdFromCheckoutObject(
    dataObject: unknown,
): string | null {
    const obj = dataObject as Record<string, unknown> | null;
    if (!obj) return null;

    const nested = obj.data as Record<string, unknown> | undefined;
    const candidates = [
        nested?.success_url,
        nested?.cancel_url,
        nested?.referer,
        obj.success_url,
        obj.cancel_url,
        obj.referer,
        (obj.metadata as Record<string, unknown> | undefined)?.success_url,
        (obj.metadata as Record<string, unknown> | undefined)?.referer,
    ];

    for (const value of candidates) {
        if (typeof value !== 'string') continue;
        const match = value.match(WORKSPACE_ID_FROM_URL_RE);
        if (match?.[1] && WORKSPACE_UUID_RE.test(match[1])) {
            return match[1];
        }
    }
    return null;
}

export async function workspaceExists(workspaceId: string): Promise<boolean> {
    if (!WORKSPACE_UUID_RE.test(workspaceId)) return false;
    const result = await query<{ ok: number }>(
        `SELECT 1 AS ok FROM ${SCHEMA}.workspaces WHERE id = $1 LIMIT 1`,
        [workspaceId],
    );
    return result.rows.length > 0;
}

/** Upsert billing_customers with Phase 2 id split (external = workspace UUID). */
export async function ensureBillingCustomerKelviqRefs(
    workspaceId: string,
    internalId: string,
): Promise<void> {
    await query(
        `INSERT INTO ${SCHEMA}.billing_customers (
             workspace_id, kelviq_customer_id, kelviq_customer_internal_id
         )
         VALUES ($1::uuid, $2::text, $3::text)
         ON CONFLICT (workspace_id) DO UPDATE SET
             kelviq_customer_id = EXCLUDED.kelviq_customer_id,
             kelviq_customer_internal_id = EXCLUDED.kelviq_customer_internal_id,
             updated_at = NOW()`,
        [workspaceId, workspaceId, internalId],
    );
}

/**
 * Resolve workspace from webhook customer ref (internal or external id).
 * Falls back to Kelviq GET /customers/{id}/ when the internal id is not in our DB yet.
 */
export async function resolveWorkspaceIdForBillingEvent(
    customerRef: string | null | undefined,
    externalCustomerId?: string | null,
): Promise<string | null> {
    const ref = customerRef?.trim();
    if (ref) {
        const fromDb = await resolveWorkspaceIdFromCustomerRef(ref);
        if (fromDb) return fromDb;

        const kelviq = await fetchKelviqCustomerByInternalId(ref);
        const external = kelviq?.customerId?.trim();
        if (external && await workspaceExists(external)) {
            await ensureBillingCustomerKelviqRefs(external, ref);
            return external;
        }
    }

    const external = externalCustomerId?.trim();
    if (external && await workspaceExists(external)) {
        if (ref && ref !== external) {
            await ensureBillingCustomerKelviqRefs(external, ref);
        }
        return external;
    }

    // Kelviq often reuses one internal customer (login email) across hosted checkouts while
    // we only stored the workspace external id. Link to the latest open checkout row.
    if (ref) {
        const pending = await resolvePendingCheckoutWorkspace(ref);
        if (pending) return pending;
    }

    return null;
}

/**
 * When hosted checkout bills a shared Kelviq customer, map that internal id to the workspace
 * that started checkout most recently (external id set, internal id not yet linked).
 */
async function resolvePendingCheckoutWorkspace(
    internalId: string,
): Promise<string | null> {
    const pending = await query<{ workspace_id: string }>(
        `SELECT workspace_id
         FROM ${SCHEMA}.billing_customers
         WHERE kelviq_customer_id IS NOT NULL
           AND kelviq_customer_id = workspace_id::text
           AND updated_at > NOW() - INTERVAL '2 hours'
         ORDER BY updated_at DESC
         LIMIT 2`,
    );

    if (pending.rows.length === 0) return null;

    if (pending.rows.length > 1) {
        console.warn(
            `[billing] Multiple pending checkouts; linking internal ${internalId} to most recent workspace ${pending.rows[0].workspace_id}`,
        );
    }

    const workspaceId = pending.rows[0].workspace_id;
    await ensureBillingCustomerKelviqRefs(workspaceId, internalId);
    return workspaceId;
}

/** External workspace UUID only — internal id is filled by Kelviq webhooks after hosted checkout. */
export async function ensureBillingCustomerExternalRef(
    workspaceId: string,
    billingEmail?: string | null,
): Promise<void> {
    await query(
        `INSERT INTO ${SCHEMA}.billing_customers (
             workspace_id, kelviq_customer_id, billing_email
         )
         VALUES ($1::uuid, $2::text, $3)
         ON CONFLICT (workspace_id) DO UPDATE SET
             kelviq_customer_id = EXCLUDED.kelviq_customer_id,
             billing_email = COALESCE(EXCLUDED.billing_email, ${SCHEMA}.billing_customers.billing_email),
             updated_at = NOW()`,
        [workspaceId, workspaceId, billingEmail ?? null],
    );
}

export async function syncKelviqCustomerRefs(
    workspaceId: string,
    internalId: string,
): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.billing_customers
         SET kelviq_customer_id = $2,
             kelviq_customer_internal_id = $3,
             updated_at = NOW()
         WHERE workspace_id = $1`,
        [workspaceId, workspaceId, internalId],
    );
}

export async function ensureKelviqInternalId(
    workspaceId: string,
    internalId: string,
): Promise<void> {
    await query(
        `UPDATE ${SCHEMA}.billing_customers
         SET kelviq_customer_internal_id = $2,
             updated_at = NOW()
         WHERE workspace_id = $1
           AND (kelviq_customer_internal_id IS NULL OR kelviq_customer_internal_id <> $2)`,
        [workspaceId, internalId],
    );
}

export interface ReconciledKelviqCustomerRefs {
    kelviq_customer_id: string;
    kelviq_customer_internal_id: string;
}

/** Resolve Kelviq internal customer id from workspace UUID when checkout left only external ref. */
export async function reconcileKelviqCustomerRefsFromKelviq(
    workspaceId: string,
): Promise<ReconciledKelviqCustomerRefs | null> {
    const kelviq = await fetchCustomerByWorkspaceId(workspaceId);
    if (!kelviq?.id) return null;

    await ensureBillingCustomerKelviqRefs(workspaceId, kelviq.id);
    return {
        kelviq_customer_id: workspaceId,
        kelviq_customer_internal_id: kelviq.id,
    };
}
