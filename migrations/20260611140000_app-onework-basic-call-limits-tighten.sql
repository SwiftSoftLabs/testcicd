-- Tighten Basic plan call limits: 10 minutes/month, 1 minute per meeting.
-- Idempotent: safe to re-run.

UPDATE app_onework.billing_plans SET
    max_call_minutes_monthly = 10,
    max_call_duration_minutes = 1,
    updated_at = NOW()
WHERE code = 'basic';
