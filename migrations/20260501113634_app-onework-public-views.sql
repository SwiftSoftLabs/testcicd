GRANT USAGE ON SCHEMA app_onework TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.profiles            TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.workspaces          TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.workspace_members   TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.projects            TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.tasks               TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.task_activities     TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.teams               TO authenticated;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA app_onework TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_onework
  GRANT USAGE ON SEQUENCES TO authenticated;

CREATE OR REPLACE VIEW public.onework_profiles
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.profiles;

CREATE OR REPLACE VIEW public.onework_workspaces
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.workspaces;

CREATE OR REPLACE VIEW public.onework_workspace_members
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.workspace_members;

CREATE OR REPLACE VIEW public.onework_projects
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.projects;

CREATE OR REPLACE VIEW public.onework_tasks
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.tasks;

CREATE OR REPLACE VIEW public.onework_task_activities
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.task_activities;

CREATE OR REPLACE VIEW public.onework_teams
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.teams;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_profiles           TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_workspaces         TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_workspace_members  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_projects           TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_tasks              TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_task_activities    TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_teams              TO authenticated;
