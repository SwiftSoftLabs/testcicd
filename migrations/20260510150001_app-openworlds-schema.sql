SET search_path TO app_openworlds;

CREATE OR REPLACE FUNCTION app_openworlds.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_openworlds.is_max_member_safe()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  has_helper boolean;
  result boolean;
BEGIN
  SELECT to_regprocedure('public.is_max_member()') IS NOT NULL INTO has_helper;
  IF NOT has_helper THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT public.is_max_member()' INTO result;
  RETURN COALESCE(result, false);
END;
$$;

CREATE TABLE IF NOT EXISTS app_openworlds.world_models (
  id text PRIMARY KEY,
  name text NOT NULL,
  company text NOT NULL,
  utility text NOT NULL,
  output_modality text NOT NULL,
  interactivity_level text NOT NULL,
  latency_target text NOT NULL,
  best_for text NOT NULL,
  color text NOT NULL DEFAULT '#14b8a6',
  outputs text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_openworlds.workflow_steps (
  slug text PRIMARY KEY,
  label text NOT NULL,
  description text,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_openworlds.staging_styles (
  slug text PRIMARY KEY,
  name text NOT NULL,
  prompt_hint text,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_openworlds.environment_presets (
  slug text PRIMARY KEY,
  name text NOT NULL,
  prompt_hint text,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_openworlds.semantic_nodes (
  slug text PRIMARY KEY,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#14b8a6',
  model_id text REFERENCES app_openworlds.world_models(id) ON DELETE SET NULL,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_openworlds.export_targets (
  slug text PRIMARY KEY,
  name text NOT NULL,
  format text NOT NULL,
  description text,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_openworlds.trust_signals (
  slug text PRIMARY KEY,
  label text NOT NULL,
  value text,
  description text,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_openworlds.world_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('real-estate','gameplay','production')),
  active_engine_id text NOT NULL REFERENCES app_openworlds.world_models(id),
  prompt text NOT NULL,
  furnishing_style text,
  environment text,
  source_files text[] NOT NULL DEFAULT '{}',
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  active_step integer NOT NULL DEFAULT 0,
  camera jsonb NOT NULL DEFAULT '{"x":0,"y":1.7,"z":0,"yaw":0}'::jsonb,
  show_floorplan boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generating','ready','published')),
  is_public boolean NOT NULL DEFAULT false,
  metrics jsonb NOT NULL DEFAULT '{"spatialConfidence":94,"groundTruthCoverage":72,"aiGeneratedSurfaces":28,"mobileFps":116}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_openworlds_sessions_owner ON app_openworlds.world_sessions (owner_id);

CREATE INDEX IF NOT EXISTS idx_openworlds_sessions_engine ON app_openworlds.world_sessions (active_engine_id);

CREATE INDEX IF NOT EXISTS idx_openworlds_sessions_status ON app_openworlds.world_sessions (status);

CREATE TABLE IF NOT EXISTS app_openworlds.source_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES app_openworlds.world_sessions(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_type text,
  storage_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_openworlds_assets_session ON app_openworlds.source_assets (session_id);

CREATE TABLE IF NOT EXISTS app_openworlds.session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES app_openworlds.world_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_openworlds_events_session ON app_openworlds.session_events (session_id);

CREATE INDEX IF NOT EXISTS idx_openworlds_events_type ON app_openworlds.session_events (event_type);

CREATE TRIGGER trg_openworlds_world_models_updated_at
BEFORE UPDATE ON app_openworlds.world_models
FOR EACH ROW EXECUTE FUNCTION app_openworlds.handle_updated_at();

CREATE TRIGGER trg_openworlds_workflow_steps_updated_at
BEFORE UPDATE ON app_openworlds.workflow_steps
FOR EACH ROW EXECUTE FUNCTION app_openworlds.handle_updated_at();

CREATE TRIGGER trg_openworlds_staging_styles_updated_at
BEFORE UPDATE ON app_openworlds.staging_styles
FOR EACH ROW EXECUTE FUNCTION app_openworlds.handle_updated_at();

CREATE TRIGGER trg_openworlds_environment_presets_updated_at
BEFORE UPDATE ON app_openworlds.environment_presets
FOR EACH ROW EXECUTE FUNCTION app_openworlds.handle_updated_at();

CREATE TRIGGER trg_openworlds_semantic_nodes_updated_at
BEFORE UPDATE ON app_openworlds.semantic_nodes
FOR EACH ROW EXECUTE FUNCTION app_openworlds.handle_updated_at();

CREATE TRIGGER trg_openworlds_export_targets_updated_at
BEFORE UPDATE ON app_openworlds.export_targets
FOR EACH ROW EXECUTE FUNCTION app_openworlds.handle_updated_at();

CREATE TRIGGER trg_openworlds_trust_signals_updated_at
BEFORE UPDATE ON app_openworlds.trust_signals
FOR EACH ROW EXECUTE FUNCTION app_openworlds.handle_updated_at();

CREATE TRIGGER trg_openworlds_world_sessions_updated_at
BEFORE UPDATE ON app_openworlds.world_sessions
FOR EACH ROW EXECUTE FUNCTION app_openworlds.handle_updated_at();

ALTER TABLE app_openworlds.world_models ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_openworlds.workflow_steps ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_openworlds.staging_styles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_openworlds.environment_presets ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_openworlds.semantic_nodes ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_openworlds.export_targets ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_openworlds.trust_signals ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_openworlds.world_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_openworlds.source_assets ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_openworlds.session_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY openworlds_world_models_read ON app_openworlds.world_models
  FOR SELECT USING (enabled = true);

CREATE POLICY openworlds_workflow_steps_read ON app_openworlds.workflow_steps
  FOR SELECT USING (true);

CREATE POLICY openworlds_staging_styles_read ON app_openworlds.staging_styles
  FOR SELECT USING (true);

CREATE POLICY openworlds_environment_presets_read ON app_openworlds.environment_presets
  FOR SELECT USING (true);

CREATE POLICY openworlds_semantic_nodes_read ON app_openworlds.semantic_nodes
  FOR SELECT USING (true);

CREATE POLICY openworlds_export_targets_read ON app_openworlds.export_targets
  FOR SELECT USING (true);

CREATE POLICY openworlds_trust_signals_read ON app_openworlds.trust_signals
  FOR SELECT USING (true);

CREATE POLICY openworlds_world_sessions_read ON app_openworlds.world_sessions
  FOR SELECT USING (
    is_public
    OR owner_id::text = public.jwt_sub()
    OR app_openworlds.is_max_member_safe()
  );

CREATE POLICY openworlds_world_sessions_insert ON app_openworlds.world_sessions
  FOR INSERT WITH CHECK (
    owner_id IS NULL
    OR (
      owner_id::text = public.jwt_sub()
      AND current_setting('request.jwt.claim.app_origin', true) = 'app_openworlds'
    )
    OR app_openworlds.is_max_member_safe()
  );

CREATE POLICY openworlds_world_sessions_update ON app_openworlds.world_sessions
  FOR UPDATE
  USING (
    owner_id IS NULL
    OR owner_id::text = public.jwt_sub()
    OR app_openworlds.is_max_member_safe()
  )
  WITH CHECK (
    owner_id IS NULL
    OR (
      owner_id::text = public.jwt_sub()
      AND current_setting('request.jwt.claim.app_origin', true) = 'app_openworlds'
    )
    OR app_openworlds.is_max_member_safe()
  );

CREATE POLICY openworlds_source_assets_read ON app_openworlds.source_assets
  FOR SELECT USING (
    owner_id IS NULL
    OR owner_id::text = public.jwt_sub()
    OR app_openworlds.is_max_member_safe()
  );

CREATE POLICY openworlds_source_assets_insert ON app_openworlds.source_assets
  FOR INSERT WITH CHECK (
    owner_id IS NULL
    OR (
      owner_id::text = public.jwt_sub()
      AND current_setting('request.jwt.claim.app_origin', true) = 'app_openworlds'
    )
    OR app_openworlds.is_max_member_safe()
  );

CREATE POLICY openworlds_session_events_read ON app_openworlds.session_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM app_openworlds.world_sessions s
      WHERE s.id = session_id
        AND (s.is_public OR s.owner_id::text = public.jwt_sub() OR app_openworlds.is_max_member_safe())
    )
  );

CREATE POLICY openworlds_session_events_insert ON app_openworlds.session_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_openworlds.world_sessions s
      WHERE s.id = session_id
        AND (s.owner_id IS NULL OR s.owner_id::text = public.jwt_sub() OR app_openworlds.is_max_member_safe())
    )
  );
