GRANT USAGE ON SCHEMA app_openworlds TO PUBLIC;

CREATE OR REPLACE VIEW public.openworlds_world_models
  WITH (security_invoker = true)
AS SELECT * FROM app_openworlds.world_models;

CREATE OR REPLACE VIEW public.openworlds_workflow_steps
  WITH (security_invoker = true)
AS SELECT * FROM app_openworlds.workflow_steps;

CREATE OR REPLACE VIEW public.openworlds_staging_styles
  WITH (security_invoker = true)
AS SELECT * FROM app_openworlds.staging_styles;

CREATE OR REPLACE VIEW public.openworlds_environment_presets
  WITH (security_invoker = true)
AS SELECT * FROM app_openworlds.environment_presets;

CREATE OR REPLACE VIEW public.openworlds_semantic_nodes
  WITH (security_invoker = true)
AS SELECT * FROM app_openworlds.semantic_nodes;

CREATE OR REPLACE VIEW public.openworlds_export_targets
  WITH (security_invoker = true)
AS SELECT * FROM app_openworlds.export_targets;

CREATE OR REPLACE VIEW public.openworlds_trust_signals
  WITH (security_invoker = true)
AS SELECT * FROM app_openworlds.trust_signals;

CREATE OR REPLACE VIEW public.openworlds_world_sessions
  WITH (security_invoker = true)
AS SELECT * FROM app_openworlds.world_sessions;

CREATE OR REPLACE VIEW public.openworlds_source_assets
  WITH (security_invoker = true)
AS SELECT * FROM app_openworlds.source_assets;

CREATE OR REPLACE VIEW public.openworlds_session_events
  WITH (security_invoker = true)
AS SELECT * FROM app_openworlds.session_events;

GRANT SELECT ON app_openworlds.world_models TO PUBLIC;

GRANT SELECT ON app_openworlds.workflow_steps TO PUBLIC;

GRANT SELECT ON app_openworlds.staging_styles TO PUBLIC;

GRANT SELECT ON app_openworlds.environment_presets TO PUBLIC;

GRANT SELECT ON app_openworlds.semantic_nodes TO PUBLIC;

GRANT SELECT ON app_openworlds.export_targets TO PUBLIC;

GRANT SELECT ON app_openworlds.trust_signals TO PUBLIC;

GRANT SELECT, INSERT, UPDATE ON app_openworlds.world_sessions TO PUBLIC;

GRANT SELECT, INSERT ON app_openworlds.source_assets TO PUBLIC;

GRANT SELECT, INSERT ON app_openworlds.session_events TO PUBLIC;

GRANT SELECT ON public.openworlds_world_models TO anon, authenticated;

GRANT SELECT ON public.openworlds_workflow_steps TO anon, authenticated;

GRANT SELECT ON public.openworlds_staging_styles TO anon, authenticated;

GRANT SELECT ON public.openworlds_environment_presets TO anon, authenticated;

GRANT SELECT ON public.openworlds_semantic_nodes TO anon, authenticated;

GRANT SELECT ON public.openworlds_export_targets TO anon, authenticated;

GRANT SELECT ON public.openworlds_trust_signals TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.openworlds_world_sessions TO anon, authenticated;

GRANT SELECT, INSERT ON public.openworlds_source_assets TO anon, authenticated;

GRANT SELECT, INSERT ON public.openworlds_session_events TO anon, authenticated;
