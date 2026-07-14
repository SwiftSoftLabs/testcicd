-- Billing seat-over notification dedup.
-- Additive only. Run manually in the InsForge dashboard.
--
-- Model: when a workspace first goes over its seat limit, stamp
-- seat_over_notified_at so admins are notified once for that overage period.
-- Clear the stamp once the workspace returns under the seat limit so a future
-- overage can notify again.

ALTER TABLE app_onework.workspace_subscriptions
    ADD COLUMN IF NOT EXISTS seat_over_notified_at TIMESTAMPTZ;
