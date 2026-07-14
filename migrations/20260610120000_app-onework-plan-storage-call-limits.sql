-- Plan-based workspace storage and call limits (app_onework)
-- Idempotent: safe to re-run on existing clusters.

ALTER TABLE app_onework.billing_plans
    ADD COLUMN IF NOT EXISTS max_storage_bytes BIGINT NOT NULL DEFAULT 10485760,
    ADD COLUMN IF NOT EXISTS max_call_minutes_monthly BIGINT,
    ADD COLUMN IF NOT EXISTS max_call_duration_minutes INTEGER;

UPDATE app_onework.billing_plans SET
    max_storage_bytes = 10485760,
    max_call_minutes_monthly = 10,
    max_call_duration_minutes = 1,
    updated_at = NOW()
WHERE code = 'basic';

UPDATE app_onework.billing_plans SET
    max_storage_bytes = 1073741824,
    max_call_minutes_monthly = 10000,
    max_call_duration_minutes = 1440,
    updated_at = NOW()
WHERE code = 'pro';

UPDATE app_onework.billing_plans SET
    max_storage_bytes = 21474836480,
    max_call_minutes_monthly = 50000,
    max_call_duration_minutes = 1440,
    updated_at = NOW()
WHERE code = 'max';

UPDATE app_onework.billing_plans SET
    max_storage_bytes = 107374182400,
    max_call_minutes_monthly = NULL,
    max_call_duration_minutes = NULL,
    updated_at = NOW()
WHERE code = 'enterprise';
