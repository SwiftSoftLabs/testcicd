CREATE OR REPLACE VIEW public.rebaterocket_profiles
  WITH (security_invoker = true)
AS SELECT * FROM app_rebaterocket.profiles;

CREATE OR REPLACE VIEW public.rebaterocket_utility_connections
  WITH (security_invoker = true)
AS SELECT * FROM app_rebaterocket.utility_connections;

CREATE OR REPLACE VIEW public.rebaterocket_documents
  WITH (security_invoker = true)
AS SELECT * FROM app_rebaterocket.documents;

CREATE OR REPLACE VIEW public.rebaterocket_rebate_applications
  WITH (security_invoker = true)
AS SELECT * FROM app_rebaterocket.rebate_applications;

CREATE OR REPLACE VIEW public.rebaterocket_notifications
  WITH (security_invoker = true)
AS SELECT * FROM app_rebaterocket.notifications;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.rebaterocket_profiles,
  public.rebaterocket_utility_connections,
  public.rebaterocket_documents,
  public.rebaterocket_rebate_applications,
  public.rebaterocket_notifications
  TO anon, authenticated;
