SET search_path TO app_jobwiseai;

ALTER TABLE app_jobwiseai.tools
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','rejected')),
  ADD COLUMN IF NOT EXISTS editor_pick boolean NOT NULL DEFAULT false;

ALTER TABLE app_jobwiseai.reviews
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending_moderation'
    CHECK (status IN ('pending_moderation','approved','rejected')),
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE app_jobwiseai.saved_tools
  ADD COLUMN IF NOT EXISTS saved_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE app_jobwiseai.user_profiles
  ADD COLUMN IF NOT EXISTS job_function text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE TABLE IF NOT EXISTS app_jobwiseai.quiz_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email          text,
  job_function   text NOT NULL,
  answers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_ids text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobwiseai_quiz_user ON app_jobwiseai.quiz_results (user_id);

CREATE TABLE IF NOT EXISTS app_jobwiseai.vendor_profiles (
  vendor_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name   text NOT NULL,
  website        text,
  logo_url       text,
  contact_email  text,
  plan           text NOT NULL DEFAULT 'standard'
    CHECK (plan IN ('standard','premium')),
  verified       boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','suspended')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_jobwiseai.subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free','basic','premium')),
  billing_cycle       text CHECK (billing_cycle IN ('monthly','annual')),
  status              text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','past_due','canceled','trialing')),
  current_period_end  timestamptz,
  stripe_sub_id       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobwiseai_subs_user ON app_jobwiseai.subscriptions (user_id);

CREATE TABLE IF NOT EXISTS app_jobwiseai.vendor_analytics_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id     uuid NOT NULL REFERENCES app_jobwiseai.tools(id) ON DELETE CASCADE,
  event_type  text NOT NULL CHECK (event_type IN ('view','click','lead')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobwiseai_analytics_tool ON app_jobwiseai.vendor_analytics_events (tool_id);

CREATE INDEX IF NOT EXISTS idx_jobwiseai_analytics_time ON app_jobwiseai.vendor_analytics_events (occurred_at DESC);

CREATE TABLE IF NOT EXISTS app_jobwiseai.coupons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  discount_pct numeric(5,2) NOT NULL CHECK (discount_pct BETWEEN 0 AND 100),
  max_uses     integer,
  used_count   integer NOT NULL DEFAULT 0,
  expires_at   timestamptz,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_jobwiseai.admin_audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target_id  text,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobwiseai_audit_admin ON app_jobwiseai.admin_audit_log (admin_id);

CREATE INDEX IF NOT EXISTS idx_jobwiseai_audit_time  ON app_jobwiseai.admin_audit_log (created_at DESC);

ALTER TABLE app_jobwiseai.quiz_results          ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_jobwiseai.vendor_profiles       ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_jobwiseai.subscriptions         ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_jobwiseai.vendor_analytics_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_jobwiseai.coupons               ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_jobwiseai.admin_audit_log       ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobwiseai_quiz_insert_public ON app_jobwiseai.quiz_results
  FOR INSERT WITH CHECK (true);

CREATE POLICY jobwiseai_quiz_select_own ON app_jobwiseai.quiz_results
  FOR SELECT USING (user_id::text = public.jwt_sub());

CREATE POLICY jobwiseai_vendor_profiles_self ON app_jobwiseai.vendor_profiles
  FOR ALL
  USING (vendor_id::text = public.jwt_sub())
  WITH CHECK (vendor_id::text = public.jwt_sub());

CREATE POLICY jobwiseai_subs_select_own ON app_jobwiseai.subscriptions
  FOR SELECT USING (user_id::text = public.jwt_sub());

CREATE POLICY jobwiseai_analytics_insert ON app_jobwiseai.vendor_analytics_events
  FOR INSERT WITH CHECK (true);

CREATE POLICY jobwiseai_analytics_vendor_read ON app_jobwiseai.vendor_analytics_events
  FOR SELECT USING (
    tool_id IN (
      SELECT id FROM app_jobwiseai.tools
      WHERE vendor_id::text = public.jwt_sub()
    )
  );

CREATE POLICY jobwiseai_coupons_read ON app_jobwiseai.coupons
  FOR SELECT USING (active = true AND (expires_at IS NULL OR expires_at > now()));

CREATE POLICY jobwiseai_audit_deny_public ON app_jobwiseai.admin_audit_log
  FOR SELECT USING (false);

GRANT SELECT, INSERT ON app_jobwiseai.quiz_results TO anon, authenticated;

GRANT SELECT ON app_jobwiseai.quiz_results TO authenticated;

GRANT ALL ON app_jobwiseai.vendor_profiles TO authenticated;

GRANT SELECT ON app_jobwiseai.subscriptions TO authenticated;

GRANT INSERT ON app_jobwiseai.vendor_analytics_events TO anon, authenticated;

GRANT SELECT ON app_jobwiseai.vendor_analytics_events TO authenticated;

GRANT SELECT ON app_jobwiseai.coupons TO authenticated;

GRANT ALL ON app_jobwiseai.coupons TO authenticated;

GRANT SELECT ON app_jobwiseai.tools TO anon, authenticated;

GRANT SELECT ON app_jobwiseai.reviews TO anon, authenticated;

GRANT ALL ON app_jobwiseai.user_profiles TO authenticated;

GRANT ALL ON app_jobwiseai.saved_tools TO authenticated;

GRANT INSERT ON app_jobwiseai.reviews TO authenticated;
