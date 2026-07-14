-- Version Control notification types + webhook delivery dedupe ledger.
-- [main] Production VC notification types — do not rename without coordinating deploy.

ALTER TABLE app_onework.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE app_onework.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (
      ARRAY[
        'mention'::text,
        'assignment'::text,
        'comment'::text,
        'review'::text,
        'system'::text,
        'call_invite'::text,
        'call_reminder'::text,
        'call_summary'::text,
        'meeting_tasks_review'::text,
        'calendar_event'::text,
        'calendar_invite'::text,
        'calendar_update'::text,
        'calendar_cancel'::text,
        'vc_pr_opened'::text,
        'vc_pr_comment'::text,
        'vc_pr_review'::text,
        'vc_pr_merged'::text,
        'vc_collaborator'::text,
        'vc_release'::text,
        'vc_push'::text,
        'vc_check'::text
      ]
    )
  );

CREATE TABLE IF NOT EXISTS app_onework.vc_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vc_webhook_deliveries_processed_at_idx
  ON app_onework.vc_webhook_deliveries (processed_at);

-- VC notifications use structured ref_id values like
-- vc:{workspaceId}:{projectId}:{extra} which are not valid UUIDs.
DROP VIEW IF EXISTS public.onework_notifications;

ALTER TABLE app_onework.notifications
  ALTER COLUMN ref_id TYPE TEXT USING ref_id::text;

CREATE OR REPLACE VIEW public.onework_notifications
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.notifications;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_notifications TO authenticated;
