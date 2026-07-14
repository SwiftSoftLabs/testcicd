-- VC notifications use structured ref_id values like
-- vc:{workspaceId}:{projectId}:{extra} which are not valid UUIDs.

DROP VIEW IF EXISTS public.onework_notifications;

ALTER TABLE app_onework.notifications
  ALTER COLUMN ref_id TYPE TEXT USING ref_id::text;

CREATE OR REPLACE VIEW public.onework_notifications
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.notifications;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_notifications TO authenticated;
