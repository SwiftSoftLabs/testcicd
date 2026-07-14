GRANT USAGE ON SCHEMA app_jobwiseai TO anon, authenticated;

CREATE OR REPLACE VIEW public.jobwiseai_tools
  WITH (security_invoker = true)
AS SELECT * FROM app_jobwiseai.tools;

CREATE OR REPLACE VIEW public.jobwiseai_user_profiles
  WITH (security_invoker = true)
AS SELECT * FROM app_jobwiseai.user_profiles;

CREATE OR REPLACE VIEW public.jobwiseai_reviews
  WITH (security_invoker = true)
AS SELECT * FROM app_jobwiseai.reviews;

CREATE OR REPLACE VIEW public.jobwiseai_saved_tools
  WITH (security_invoker = true)
AS SELECT * FROM app_jobwiseai.saved_tools;

CREATE OR REPLACE VIEW public.jobwiseai_stat_metrics
  WITH (security_invoker = true)
AS SELECT * FROM app_jobwiseai.stat_metrics;

CREATE OR REPLACE VIEW public.jobwiseai_quiz_results
  WITH (security_invoker = true)
AS SELECT * FROM app_jobwiseai.quiz_results;

CREATE OR REPLACE VIEW public.jobwiseai_vendor_profiles
  WITH (security_invoker = true)
AS SELECT * FROM app_jobwiseai.vendor_profiles;

CREATE OR REPLACE VIEW public.jobwiseai_subscriptions
  WITH (security_invoker = true)
AS SELECT * FROM app_jobwiseai.subscriptions;

CREATE OR REPLACE VIEW public.jobwiseai_vendor_analytics_events
  WITH (security_invoker = true)
AS SELECT * FROM app_jobwiseai.vendor_analytics_events;

CREATE OR REPLACE VIEW public.jobwiseai_coupons
  WITH (security_invoker = true)
AS SELECT * FROM app_jobwiseai.coupons;

CREATE OR REPLACE VIEW public.jobwiseai_admin_audit_log
  WITH (security_invoker = true)
AS SELECT * FROM app_jobwiseai.admin_audit_log;

GRANT SELECT ON public.jobwiseai_tools                    TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobwiseai_user_profiles         TO authenticated;

GRANT SELECT ON public.jobwiseai_reviews                  TO anon, authenticated;

GRANT INSERT ON public.jobwiseai_reviews                  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobwiseai_saved_tools           TO authenticated;

GRANT SELECT ON public.jobwiseai_stat_metrics             TO anon, authenticated;

GRANT SELECT, INSERT ON public.jobwiseai_quiz_results     TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobwiseai_vendor_profiles       TO authenticated;

GRANT SELECT ON public.jobwiseai_subscriptions            TO authenticated;

GRANT SELECT, INSERT ON public.jobwiseai_vendor_analytics_events TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobwiseai_coupons               TO authenticated;

GRANT SELECT ON public.jobwiseai_admin_audit_log          TO authenticated;
