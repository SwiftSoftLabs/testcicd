SET search_path TO app_safebuilds;

CREATE TABLE IF NOT EXISTS app_safebuilds.user_profiles (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization text NOT NULL DEFAULT 'New Workspace',
  industry     text NOT NULL DEFAULT 'healthcare'
                CHECK (industry IN ('healthcare','real_estate','legal')),
  role         text NOT NULL DEFAULT 'admin'
                CHECK (role IN ('admin','compliance_officer','builder','viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_safebuilds.form_templates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                 text NOT NULL DEFAULT 'Untitled form',
  industry             text NOT NULL CHECK (industry IN ('healthcare','real_estate','legal')),
  fields               jsonb NOT NULL DEFAULT '[]'::jsonb,
  public_share         boolean NOT NULL DEFAULT false,
  export_endpoint      text,
  export_encrypted     boolean NOT NULL DEFAULT true,
  diagnoses_or_treats  boolean NOT NULL DEFAULT false,
  published            boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safebuilds_templates_owner    ON app_safebuilds.form_templates (owner_id);

CREATE INDEX IF NOT EXISTS idx_safebuilds_templates_industry ON app_safebuilds.form_templates (industry);

CREATE TABLE IF NOT EXISTS app_safebuilds.form_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL REFERENCES app_safebuilds.form_templates(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  values          jsonb NOT NULL DEFAULT '{}'::jsonb,
  sensitive_keys  text[] NOT NULL DEFAULT '{}',
  submitted_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safebuilds_submissions_template ON app_safebuilds.form_submissions (template_id);

CREATE INDEX IF NOT EXISTS idx_safebuilds_submissions_owner    ON app_safebuilds.form_submissions (owner_id);

CREATE TABLE IF NOT EXISTS app_safebuilds.audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  text NOT NULL,
  actor_role   text NOT NULL,
  action       text NOT NULL,
  target       text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_safebuilds_audit_ts    ON app_safebuilds.audit_logs (ts DESC);

CREATE INDEX IF NOT EXISTS idx_safebuilds_audit_actor ON app_safebuilds.audit_logs (actor_id);

CREATE TRIGGER trg_safebuilds_user_profiles_updated_at
BEFORE UPDATE ON app_safebuilds.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_safebuilds_form_templates_updated_at
BEFORE UPDATE ON app_safebuilds.form_templates
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE app_safebuilds.user_profiles    ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_safebuilds.form_templates   ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_safebuilds.form_submissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_safebuilds.audit_logs       ENABLE ROW LEVEL SECURITY;

CREATE POLICY safebuilds_profiles_self ON app_safebuilds.user_profiles
  FOR ALL
  USING      (user_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_safebuilds')
  WITH CHECK (user_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_safebuilds');

CREATE POLICY safebuilds_templates_owner ON app_safebuilds.form_templates
  FOR ALL
  USING      (owner_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_safebuilds')
  WITH CHECK (owner_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_safebuilds');

CREATE POLICY safebuilds_submissions_owner ON app_safebuilds.form_submissions
  FOR ALL
  USING      (owner_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_safebuilds')
  WITH CHECK (owner_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_safebuilds');

CREATE POLICY safebuilds_audit_read_self ON app_safebuilds.audit_logs
  FOR SELECT
  USING (actor_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_safebuilds');

CREATE POLICY safebuilds_audit_insert_self ON app_safebuilds.audit_logs
  FOR INSERT
  WITH CHECK (actor_id::text = public.jwt_sub() AND current_setting('request.jwt.claim.app_origin', true) = 'app_safebuilds');

REVOKE UPDATE, DELETE ON app_safebuilds.audit_logs FROM PUBLIC;

REVOKE UPDATE, DELETE ON app_safebuilds.audit_logs FROM authenticated;

REVOKE UPDATE, DELETE ON app_safebuilds.audit_logs FROM app_safebuilds_user;
