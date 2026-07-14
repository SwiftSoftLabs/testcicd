-- Calendar invite notification delivery ledger (dedupe per user, channel, revision).
-- Run against the existing SwiftSoftLabs InsForge project.

CREATE TABLE IF NOT EXISTS app_onework.event_invite_notification_deliveries (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email')),
  event_id UUID,
  series_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, dedupe_key, channel)
);

CREATE INDEX IF NOT EXISTS event_invite_notification_deliveries_event_id_idx
  ON app_onework.event_invite_notification_deliveries (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_invite_notification_deliveries_series_id_idx
  ON app_onework.event_invite_notification_deliveries (series_id)
  WHERE series_id IS NOT NULL;

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
        'calendar_cancel'::text
      ]
    )
  );
