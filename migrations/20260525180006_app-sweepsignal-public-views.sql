CREATE OR REPLACE VIEW public.sweepsignal_profiles
  WITH (security_invoker = true)
AS SELECT * FROM app_sweepsignal.profiles;

CREATE OR REPLACE VIEW public.sweepsignal_projects
  WITH (security_invoker = true)
AS SELECT * FROM app_sweepsignal.projects;

CREATE OR REPLACE VIEW public.sweepsignal_job_orders
  WITH (security_invoker = true)
AS SELECT * FROM app_sweepsignal.job_orders;

CREATE OR REPLACE VIEW public.sweepsignal_checklist_items
  WITH (security_invoker = true)
AS SELECT * FROM app_sweepsignal.checklist_items;

CREATE OR REPLACE VIEW public.sweepsignal_proof_photos
  WITH (security_invoker = true)
AS SELECT * FROM app_sweepsignal.proof_photos;

CREATE OR REPLACE VIEW public.sweepsignal_time_logs
  WITH (security_invoker = true)
AS SELECT * FROM app_sweepsignal.time_logs;

CREATE OR REPLACE VIEW public.sweepsignal_site_issues
  WITH (security_invoker = true)
AS SELECT * FROM app_sweepsignal.site_issues;

CREATE OR REPLACE VIEW public.sweepsignal_notifications
  WITH (security_invoker = true)
AS SELECT * FROM app_sweepsignal.notifications;

CREATE OR REPLACE VIEW public.sweepsignal_handover_reports
  WITH (security_invoker = true)
AS SELECT * FROM app_sweepsignal.handover_reports;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.sweepsignal_profiles,
  public.sweepsignal_checklist_items,
  public.sweepsignal_proof_photos,
  public.sweepsignal_time_logs,
  public.sweepsignal_site_issues,
  public.sweepsignal_notifications,
  public.sweepsignal_handover_reports
  TO authenticated;

GRANT SELECT, UPDATE ON public.sweepsignal_job_orders TO authenticated;

GRANT SELECT ON public.sweepsignal_projects TO authenticated;
