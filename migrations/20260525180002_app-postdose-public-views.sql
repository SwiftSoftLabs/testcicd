CREATE OR REPLACE VIEW public.postdose_profiles
  WITH (security_invoker = true)
AS SELECT * FROM app_postdose.profiles;

CREATE OR REPLACE VIEW public.postdose_injection_logs
  WITH (security_invoker = true)
AS SELECT * FROM app_postdose.injection_logs;

CREATE OR REPLACE VIEW public.postdose_hydration_logs
  WITH (security_invoker = true)
AS SELECT * FROM app_postdose.hydration_logs;

CREATE OR REPLACE VIEW public.postdose_meal_logs
  WITH (security_invoker = true)
AS SELECT * FROM app_postdose.meal_logs;

CREATE OR REPLACE VIEW public.postdose_symptom_checkins
  WITH (security_invoker = true)
AS SELECT * FROM app_postdose.symptom_checkins;

CREATE OR REPLACE VIEW public.postdose_saved_recipes
  WITH (security_invoker = true)
AS SELECT * FROM app_postdose.saved_recipes;

CREATE OR REPLACE VIEW public.postdose_recipes
  WITH (security_invoker = true)
AS SELECT * FROM app_postdose.recipes;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.postdose_profiles,
  public.postdose_injection_logs,
  public.postdose_hydration_logs,
  public.postdose_meal_logs,
  public.postdose_symptom_checkins,
  public.postdose_saved_recipes
  TO authenticated;

GRANT SELECT ON public.postdose_recipes TO anon, authenticated;
