-- Phase 2: split Kelviq external customer ref (workspace UUID) from internal Kelviq UUID.
-- Run on app_onework before deploying Phase 2 app code, then run scripts/backfill-kelviq-customer-ids.ts

ALTER TABLE app_onework.billing_customers
    ADD COLUMN IF NOT EXISTS kelviq_customer_internal_id TEXT;

CREATE INDEX IF NOT EXISTS billing_customers_kelviq_internal_id_idx
    ON app_onework.billing_customers (kelviq_customer_internal_id)
    WHERE kelviq_customer_internal_id IS NOT NULL;
