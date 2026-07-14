CREATE SCHEMA IF NOT EXISTS app_truevehicle;

CREATE OR REPLACE FUNCTION public.jwt_sub()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '');
$$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_truevehicle_app_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
BEGIN
  NEW.metadata = COALESCE(NEW.metadata, '{}'::jsonb) || '{"app_origin":"app_truevehicle"}'::jsonb;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_truevehicle_app_origin ON auth.users;

CREATE TRIGGER trg_enforce_truevehicle_app_origin
BEFORE INSERT OR UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.enforce_truevehicle_app_origin();

CREATE TABLE IF NOT EXISTS app_truevehicle.user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'BUYER',
  subscription_tier text NOT NULL DEFAULT 'free',
  api_credits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_truevehicle.vehicles (
  vin text PRIMARY KEY CHECK (char_length(vin) = 17),
  make text,
  model text,
  year integer,
  trim text,
  build_sheet_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_scan_date timestamptz,
  cached_truth_score integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_truevehicle.visual_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin text NOT NULL REFERENCES app_truevehicle.vehicles(vin) ON DELETE CASCADE,
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  roboflow_job_id text,
  detections_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  overall_condition_grade text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_truevehicle.vehicle_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vin text NOT NULL REFERENCES app_truevehicle.vehicles(vin) ON DELETE CASCADE,
  visual_analysis_id uuid REFERENCES app_truevehicle.visual_analyses(id) ON DELETE SET NULL,
  report_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  geo_risk_score numeric(6,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_truevehicle.market_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin text NOT NULL REFERENCES app_truevehicle.vehicles(vin) ON DELETE CASCADE,
  listing_price numeric(12,2),
  market_average_price numeric(12,2),
  comparables_count integer NOT NULL DEFAULT 0,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_truevehicle.registration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin text NOT NULL REFERENCES app_truevehicle.vehicles(vin) ON DELETE CASCADE,
  state text,
  city text,
  zip_code text,
  start_date date,
  end_date date,
  is_flood_zone boolean NOT NULL DEFAULT false,
  fema_declaration_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_truevehicle.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  vin text,
  action text NOT NULL,
  permissible_use text NOT NULL,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_truevehicle_visual_analyses_vin ON app_truevehicle.visual_analyses(vin);

CREATE INDEX IF NOT EXISTS idx_truevehicle_reports_user_id ON app_truevehicle.vehicle_reports(user_id);

CREATE INDEX IF NOT EXISTS idx_truevehicle_reports_vin ON app_truevehicle.vehicle_reports(vin);

CREATE INDEX IF NOT EXISTS idx_truevehicle_market_data_vin_scraped_at ON app_truevehicle.market_data(vin, scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_truevehicle_registration_events_vin_dates ON app_truevehicle.registration_events(vin, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_truevehicle_audit_logs_user_created_at ON app_truevehicle.audit_logs(user_id, created_at DESC);

CREATE TRIGGER trg_truevehicle_user_profiles_updated_at
BEFORE UPDATE ON app_truevehicle.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_truevehicle_vehicles_updated_at
BEFORE UPDATE ON app_truevehicle.vehicles
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_truevehicle_visual_analyses_updated_at
BEFORE UPDATE ON app_truevehicle.visual_analyses
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_truevehicle_vehicle_reports_updated_at
BEFORE UPDATE ON app_truevehicle.vehicle_reports
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_truevehicle_market_data_updated_at
BEFORE UPDATE ON app_truevehicle.market_data
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_truevehicle_registration_events_updated_at
BEFORE UPDATE ON app_truevehicle.registration_events
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
