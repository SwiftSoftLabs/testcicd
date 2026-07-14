SET search_path TO app_meridian;

CREATE TABLE IF NOT EXISTS app_meridian.user_profiles (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  org_name   text,
  role       text NOT NULL DEFAULT 'OWNER'
    CHECK (role IN ('OWNER','ADMIN','REP')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_meridian.accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      text NOT NULL UNIQUE,
  name        text NOT NULL,
  size        text NOT NULL DEFAULT 'Mid-Market'
    CHECK (size IN ('Startup','Mid-Market','Enterprise')),
  industry    text,
  hq          text,
  velocity_90d integer[] NOT NULL DEFAULT '{}',
  department_mix jsonb NOT NULL DEFAULT '{}'::jsonb,
  competitor_tools text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meridian_accounts_size ON app_meridian.accounts (size);

CREATE TABLE IF NOT EXISTS app_meridian.signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES app_meridian.accounts(id) ON DELETE CASCADE,
  job_title       text NOT NULL,
  department      text NOT NULL,
  location        text,
  posted_at       timestamptz NOT NULL,
  source          text NOT NULL
    CHECK (source IN ('LinkedIn','Indeed','Wellfound','Dice','Built In')),
  category        text NOT NULL
    CHECK (category IN ('Growth Mode','Infrastructure Expansion','Compliance & Risk','Sales Operations')),
  intent_score    integer NOT NULL CHECK (intent_score BETWEEN 0 AND 100),
  mandate         text NOT NULL,
  hiring_manager  jsonb,
  tech_keywords   text[] NOT NULL DEFAULT '{}',
  reasoning       text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meridian_signals_account ON app_meridian.signals (account_id);

CREATE INDEX IF NOT EXISTS idx_meridian_signals_category ON app_meridian.signals (category);

CREATE INDEX IF NOT EXISTS idx_meridian_signals_posted ON app_meridian.signals (posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_meridian_signals_score ON app_meridian.signals (intent_score DESC);

CREATE TABLE IF NOT EXISTS app_meridian.alert_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  category    text NOT NULL DEFAULT 'Any'
    CHECK (category IN ('Any','Growth Mode','Infrastructure Expansion','Compliance & Risk','Sales Operations')),
  min_size    text NOT NULL DEFAULT 'Any'
    CHECK (min_size IN ('Any','Startup','Mid-Market','Enterprise')),
  destination text NOT NULL CHECK (destination IN ('Slack','Email','Webhook')),
  target      text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meridian_alert_rules_owner ON app_meridian.alert_rules (owner_id);

CREATE TABLE IF NOT EXISTS app_meridian.integrations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    text NOT NULL
    CHECK (provider IN ('salesforce','hubspot','slack','email','apollo','gemini')),
  connected   boolean NOT NULL DEFAULT false,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, provider)
);

CREATE TABLE IF NOT EXISTS app_meridian.feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id   uuid NOT NULL REFERENCES app_meridian.signals(id) ON DELETE CASCADE,
  rep_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verdict     text NOT NULL CHECK (verdict IN ('WIN','LOSS','NOISE')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meridian_feedback_signal ON app_meridian.feedback (signal_id);

CREATE TABLE IF NOT EXISTS app_meridian.target_accounts (
  owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES app_meridian.accounts(id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, account_id)
);

ALTER TABLE app_meridian.user_profiles  ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_meridian.alert_rules    ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_meridian.integrations   ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_meridian.feedback       ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_meridian.target_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_meridian.accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_meridian.signals  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user owns profile" ON app_meridian.user_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user owns alert rules" ON app_meridian.alert_rules
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "user owns integrations" ON app_meridian.integrations
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "user owns feedback" ON app_meridian.feedback
  FOR ALL TO authenticated
  USING (rep_id = auth.uid())
  WITH CHECK (rep_id = auth.uid());

CREATE POLICY "user owns TAL" ON app_meridian.target_accounts
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "meridian users read accounts" ON app_meridian.accounts
  FOR SELECT TO authenticated, anon
  USING (app_meridian.is_meridian_user() OR true);

CREATE POLICY "meridian users read signals" ON app_meridian.signals
  FOR SELECT TO authenticated, anon
  USING (app_meridian.is_meridian_user() OR true);

GRANT USAGE ON SCHEMA app_meridian TO anon, authenticated;

GRANT SELECT ON app_meridian.accounts, app_meridian.signals TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  app_meridian.user_profiles,
  app_meridian.alert_rules,
  app_meridian.integrations,
  app_meridian.feedback,
  app_meridian.target_accounts
  TO authenticated;
