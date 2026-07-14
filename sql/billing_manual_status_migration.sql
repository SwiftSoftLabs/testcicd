-- Adds a 'manual' subscription status: entitled outside the automated billing
-- flow (e.g. enterprise contracts provisioned by hand). Treated as a paid
-- status by isPaidEntitlementStatus() in src/lib/billing/subscription.ts.
--
-- Run in the InsForge SQL editor.

-- The original inline column CHECK is auto-named '<table>_status_check' by
-- Postgres. If InsForge named it differently, find it with:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'app_onework.workspace_subscriptions'::regclass
--     AND contype = 'c';
-- and adjust the DROP below.

ALTER TABLE app_onework.workspace_subscriptions
    DROP CONSTRAINT IF EXISTS workspace_subscriptions_status_check;

ALTER TABLE app_onework.workspace_subscriptions
    ADD CONSTRAINT workspace_subscriptions_status_check
    CHECK (status IN ('basic','pending','active','past_due','canceled','trialing','manual'));
