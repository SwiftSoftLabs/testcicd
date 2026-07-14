SET search_path TO app_postdose;

CREATE TABLE IF NOT EXISTS app_postdose.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  medication TEXT,
  dose_mg NUMERIC(6,2),
  last_injection_at TIMESTAMPTZ,
  height_cm NUMERIC(5,1),
  weight_kg NUMERIC(5,1),
  activity_level TEXT DEFAULT 'moderate',
  protein_target_g INTEGER DEFAULT 120,
  hydration_target_ml INTEGER DEFAULT 2500,
  onboarding_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_postdose.injection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  injected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dose_mg NUMERIC(6,2),
  site TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postdose_injection_logs_user ON app_postdose.injection_logs (user_id, injected_at DESC);

CREATE TABLE IF NOT EXISTS app_postdose.hydration_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_ml INTEGER NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postdose_hydration_logs_user ON app_postdose.hydration_logs (user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS app_postdose.meal_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  calories INTEGER DEFAULT 0,
  protein_g NUMERIC(6,1) DEFAULT 0,
  carbs_g NUMERIC(6,1) DEFAULT 0,
  fat_g NUMERIC(6,1) DEFAULT 0,
  meal_type TEXT DEFAULT 'snack',
  source TEXT DEFAULT 'manual',
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postdose_meal_logs_user ON app_postdose.meal_logs (user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS app_postdose.symptom_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nausea INTEGER CHECK (nausea BETWEEN 0 AND 10),
  fatigue INTEGER CHECK (fatigue BETWEEN 0 AND 10),
  food_noise INTEGER CHECK (food_noise BETWEEN 0 AND 10),
  notes TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_postdose_symptom_checkins_user ON app_postdose.symptom_checkins (user_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS app_postdose.saved_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id TEXT NOT NULL,
  title TEXT NOT NULL,
  phase TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, recipe_id)
);

CREATE TABLE IF NOT EXISTS app_postdose.recipes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  phase TEXT NOT NULL,
  protein_g INTEGER DEFAULT 0,
  calories INTEGER DEFAULT 0,
  tag TEXT,
  image_url TEXT
);

ALTER TABLE app_postdose.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_postdose.injection_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_postdose.hydration_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_postdose.meal_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_postdose.symptom_checkins ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_postdose.saved_recipes ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_postdose.recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY postdose_profiles_own ON app_postdose.profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY postdose_injection_logs_own ON app_postdose.injection_logs
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY postdose_hydration_logs_own ON app_postdose.hydration_logs
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY postdose_meal_logs_own ON app_postdose.meal_logs
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY postdose_symptom_checkins_own ON app_postdose.symptom_checkins
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY postdose_saved_recipes_own ON app_postdose.saved_recipes
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY postdose_recipes_read ON app_postdose.recipes
  FOR SELECT TO authenticated, anon
  USING (app_postdose.is_postdose_user() OR public.is_max_member(auth.uid()) OR true);

GRANT USAGE ON SCHEMA app_postdose TO anon, authenticated;

GRANT SELECT ON app_postdose.recipes TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  app_postdose.profiles,
  app_postdose.injection_logs,
  app_postdose.hydration_logs,
  app_postdose.meal_logs,
  app_postdose.symptom_checkins,
  app_postdose.saved_recipes
  TO authenticated;
