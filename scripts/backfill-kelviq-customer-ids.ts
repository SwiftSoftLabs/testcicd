/**
 * One-shot backfill: split kelviq_customer_id (external workspace UUID) from
 * kelviq_customer_internal_id (Kelviq data.id).
 *
 * Usage: npx tsx scripts/backfill-kelviq-customer-ids.ts
 * Requires KELVIQ_API_KEY and DB env (same as app).
 */

import { loadEnvConfig } from '@next/env';

interface BillingCustomerRow {
    workspace_id: string;
    kelviq_customer_id: string | null;
    kelviq_customer_internal_id: string | null;
}

async function main() {
    loadEnvConfig(process.cwd());
    const { query, SCHEMA } = await import('@/lib/db');
    const { fetchCustomerByWorkspaceId } = await import('@/lib/integrations/kelviq/client');
    const { isExternalKelviqCustomerRef } = await import('@/lib/billing/kelviq-customer-id-helpers');

    const result = await query<BillingCustomerRow>(
        `SELECT workspace_id, kelviq_customer_id, kelviq_customer_internal_id
         FROM ${SCHEMA}.billing_customers
         WHERE kelviq_customer_id IS NOT NULL
            OR kelviq_customer_internal_id IS NOT NULL`,
    );

    let updated = 0;
    let skipped = 0;
    const failures: string[] = [];

    for (const row of result.rows) {
        try {
            const workspaceId = row.workspace_id;
            let internalId = row.kelviq_customer_internal_id;
            const externalId = workspaceId;

            if (!internalId && row.kelviq_customer_id) {
                if (!isExternalKelviqCustomerRef(row.kelviq_customer_id, workspaceId)) {
                    internalId = row.kelviq_customer_id;
                }
            }

            const kelviqCustomer = await fetchCustomerByWorkspaceId(workspaceId);
            if (kelviqCustomer?.id) {
                internalId = kelviqCustomer.id;
            } else if (!internalId) {
                failures.push(
                    `${workspaceId}: no internal id in DB and Kelviq GET by customer_id returned empty`,
                );
                continue;
            }

            const needsUpdate =
                row.kelviq_customer_id !== externalId
                || row.kelviq_customer_internal_id !== internalId;

            if (!needsUpdate) {
                skipped += 1;
                continue;
            }

            await query(
                `UPDATE ${SCHEMA}.billing_customers
                 SET kelviq_customer_id = $2,
                     kelviq_customer_internal_id = $3,
                     updated_at = NOW()
                 WHERE workspace_id = $1`,
                [workspaceId, externalId, internalId],
            );
            updated += 1;
            process.stdout.write(
                `Updated ${workspaceId}: external=${externalId} internal=${internalId}\n`,
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            failures.push(`${row.workspace_id}: ${message}`);
        }
    }

    process.stdout.write(`\nDone. updated=${updated} skipped=${skipped} failed=${failures.length}\n`);
    if (failures.length > 0) {
        for (const f of failures) {
            process.stderr.write(`- ${f}\n`);
        }
        process.exit(1);
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Backfill failed: ${message}\n`);
    process.exit(1);
});
