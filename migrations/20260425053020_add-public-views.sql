GRANT USAGE ON SCHEMA app_Authentic TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_Authentic.profiles       TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_Authentic.assets         TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_Authentic.forensic_points TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_Authentic.timeline_events TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_Authentic.api_keys       TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_Authentic.webhooks       TO authenticated;

CREATE OR REPLACE VIEW public.authentic_profiles
  WITH (security_invoker = true)
AS SELECT * FROM app_Authentic.profiles;

CREATE OR REPLACE VIEW public.authentic_assets
  WITH (security_invoker = true)
AS SELECT * FROM app_Authentic.assets;

CREATE OR REPLACE VIEW public.authentic_forensic_points
  WITH (security_invoker = true)
AS SELECT * FROM app_Authentic.forensic_points;

CREATE OR REPLACE VIEW public.authentic_timeline_events
  WITH (security_invoker = true)
AS SELECT * FROM app_Authentic.timeline_events;

CREATE OR REPLACE VIEW public.authentic_api_keys
  WITH (security_invoker = true)
AS SELECT * FROM app_Authentic.api_keys;

CREATE OR REPLACE VIEW public.authentic_webhooks
  WITH (security_invoker = true)
AS SELECT * FROM app_Authentic.webhooks;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.authentic_profiles        TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.authentic_assets          TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.authentic_forensic_points TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.authentic_timeline_events TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.authentic_api_keys        TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.authentic_webhooks        TO authenticated;
