SET search_path TO app_jobwiseai;

CREATE TABLE IF NOT EXISTS app_jobwiseai.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'FREE_USER'
    CHECK (role IN ('GUEST','FREE_USER','BASIC_SUBSCRIBER','PREMIUM_SUBSCRIBER','VENDOR','ADMIN')),
  display_name text,
  company text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_jobwiseai.tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  one_liner text,
  description text,
  categories text[] NOT NULL DEFAULT '{}',
  role text,
  rating numeric(3,2) NOT NULL DEFAULT 0,
  reviews_count integer NOT NULL DEFAULT 0,
  pricing_model text NOT NULL DEFAULT 'Freemium'
    CHECK (pricing_model IN ('Freemium','Paid','Trial','Contact')),
  integration_difficulty smallint NOT NULL DEFAULT 5
    CHECK (integration_difficulty BETWEEN 1 AND 10),
  verified boolean NOT NULL DEFAULT false,
  website_url text,
  overview text,
  key_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  pros jsonb NOT NULL DEFAULT '[]'::jsonb,
  cons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ideal_use_case text,
  implementation_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  roi jsonb,
  vendor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobwiseai_tools_categories ON app_jobwiseai.tools USING gin (categories);

CREATE INDEX IF NOT EXISTS idx_jobwiseai_tools_rating ON app_jobwiseai.tools (rating DESC);

CREATE INDEX IF NOT EXISTS idx_jobwiseai_tools_vendor ON app_jobwiseai.tools (vendor_id);

CREATE TABLE IF NOT EXISTS app_jobwiseai.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id uuid NOT NULL REFERENCES app_jobwiseai.tools(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author text NOT NULL,
  role text,
  company text,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text text NOT NULL,
  time_saved text,
  is_roi_story boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobwiseai_reviews_tool ON app_jobwiseai.reviews (tool_id);

CREATE INDEX IF NOT EXISTS idx_jobwiseai_reviews_author ON app_jobwiseai.reviews (author_id);

CREATE TABLE IF NOT EXISTS app_jobwiseai.saved_tools (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_id uuid NOT NULL REFERENCES app_jobwiseai.tools(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tool_id)
);

CREATE TABLE IF NOT EXISTS app_jobwiseai.stat_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  value text NOT NULL,
  change text,
  trend text NOT NULL DEFAULT 'up' CHECK (trend IN ('up','down')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_jobwiseai_user_profiles_updated_at
BEFORE UPDATE ON app_jobwiseai.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_jobwiseai_tools_updated_at
BEFORE UPDATE ON app_jobwiseai.tools
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_jobwiseai_reviews_updated_at
BEFORE UPDATE ON app_jobwiseai.reviews
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE app_jobwiseai.user_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_jobwiseai.tools ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_jobwiseai.reviews ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_jobwiseai.saved_tools ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_jobwiseai.stat_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobwiseai_tools_read_all ON app_jobwiseai.tools
  FOR SELECT USING (true);

CREATE POLICY jobwiseai_tools_vendor_write ON app_jobwiseai.tools
  FOR ALL
  USING (vendor_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_jobwiseai')
  WITH CHECK (vendor_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_jobwiseai');

CREATE POLICY jobwiseai_reviews_read_all ON app_jobwiseai.reviews
  FOR SELECT USING (true);

CREATE POLICY jobwiseai_reviews_author_write ON app_jobwiseai.reviews
  FOR ALL
  USING (author_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_jobwiseai')
  WITH CHECK (author_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_jobwiseai');

CREATE POLICY jobwiseai_user_profiles_self ON app_jobwiseai.user_profiles
  FOR ALL
  USING (user_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_jobwiseai')
  WITH CHECK (user_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_jobwiseai');

CREATE POLICY jobwiseai_saved_tools_self ON app_jobwiseai.saved_tools
  FOR ALL
  USING (user_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_jobwiseai')
  WITH CHECK (user_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_jobwiseai');

CREATE POLICY jobwiseai_stat_metrics_read_all ON app_jobwiseai.stat_metrics
  FOR SELECT USING (true);
