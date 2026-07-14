GRANT USAGE ON SCHEMA app_safebuilds TO anon, authenticated;

CREATE OR REPLACE VIEW public.safebuilds_user_profiles
  WITH (security_invoker = true)
AS SELECT * FROM app_safebuilds.user_profiles;

CREATE OR REPLACE VIEW public.safebuilds_form_templates
  WITH (security_invoker = true)
AS SELECT * FROM app_safebuilds.form_templates;

CREATE OR REPLACE VIEW public.safebuilds_form_submissions
  WITH (security_invoker = true)
AS SELECT * FROM app_safebuilds.form_submissions;

CREATE OR REPLACE VIEW public.safebuilds_audit_logs
  WITH (security_invoker = true)
AS SELECT * FROM app_safebuilds.audit_logs;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.safebuilds_user_profiles    TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.safebuilds_form_templates   TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.safebuilds_form_submissions TO authenticated;

GRANT SELECT, INSERT ON public.safebuilds_audit_logs TO authenticated;
