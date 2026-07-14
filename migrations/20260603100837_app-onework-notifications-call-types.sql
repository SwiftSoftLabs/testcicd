-- Allow call-related notification types used by the calls module.
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
        'meeting_tasks_review'::text
      ]
    )
  );
