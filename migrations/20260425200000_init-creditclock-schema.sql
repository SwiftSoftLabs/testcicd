CREATE TABLE IF NOT EXISTS app_creditclock.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       text,
  phone           text,
  avatar_url      text,
  plan            text NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic','pro','enterprise')),
  app_origin      text NOT NULL DEFAULT 'app_creditclock',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_creditclock.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: owner access"
  ON app_creditclock.profiles
  FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE TABLE IF NOT EXISTS app_creditclock.user_goals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_price    numeric(12,2),
  closing_date    date,
  target_score    int NOT NULL DEFAULT 740,
  current_score   int NOT NULL DEFAULT 620,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_creditclock.user_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_goals: owner access"
  ON app_creditclock.user_goals
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS app_creditclock.credit_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_name       text NOT NULL,
  account_name    text NOT NULL,
  last_four       text,
  account_type    text NOT NULL DEFAULT 'credit_card' CHECK (account_type IN ('credit_card','installment','mortgage','auto','student')),
  credit_limit    numeric(12,2),
  current_balance numeric(12,2) NOT NULL DEFAULT 0,
  statement_closing_day int CHECK (statement_closing_day BETWEEN 1 AND 31),
  reporting_day   int CHECK (reporting_day BETWEEN 1 AND 31),
  due_day         int CHECK (due_day BETWEEN 1 AND 31),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','frozen')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_creditclock.credit_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_accounts: owner access"
  ON app_creditclock.credit_accounts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS credit_accounts_user_idx ON app_creditclock.credit_accounts (user_id);

CREATE TABLE IF NOT EXISTS app_creditclock.credit_scores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bureau          text NOT NULL CHECK (bureau IN ('equifax','experian','transunion')),
  score           int NOT NULL CHECK (score BETWEEN 300 AND 850),
  recorded_at     date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_creditclock.credit_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_scores: owner access"
  ON app_creditclock.credit_scores
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS credit_scores_user_date_idx ON app_creditclock.credit_scores (user_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS app_creditclock.calendar_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id      uuid REFERENCES app_creditclock.credit_accounts(id) ON DELETE SET NULL,
  event_date      date NOT NULL,
  event_type      text NOT NULL CHECK (event_type IN ('closing','reporting','payment_15','payment_3','due_date')),
  impact          text NOT NULL DEFAULT 'medium' CHECK (impact IN ('high','medium','low')),
  title           text NOT NULL,
  notes           text,
  is_completed    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_creditclock.calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_events: owner access"
  ON app_creditclock.calendar_events
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS calendar_events_user_date_idx ON app_creditclock.calendar_events (user_id, event_date);

CREATE TABLE IF NOT EXISTS app_creditclock.action_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id      uuid REFERENCES app_creditclock.credit_accounts(id) ON DELETE SET NULL,
  title           text NOT NULL,
  description     text,
  due_date        date,
  impact_points   int NOT NULL DEFAULT 0,
  impact_level    text NOT NULL DEFAULT 'medium' CHECK (impact_level IN ('high','medium','low')),
  category        text NOT NULL DEFAULT 'utilization' CHECK (category IN ('utilization','payment','inquiry','dispute','mix')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_creditclock.action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "action_items: owner access"
  ON app_creditclock.action_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS action_items_user_status_idx ON app_creditclock.action_items (user_id, status);

CREATE TABLE IF NOT EXISTS app_creditclock.simulations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT 'My Strategy',
  debt_paydown    numeric(12,2) NOT NULL DEFAULT 0,
  close_account   boolean NOT NULL DEFAULT false,
  open_new_credit boolean NOT NULL DEFAULT false,
  base_score      int NOT NULL,
  projected_score int NOT NULL,
  total_impact    int NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_creditclock.simulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "simulations: owner access"
  ON app_creditclock.simulations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS app_creditclock.audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type      text NOT NULL,
  severity        text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','error','critical')),
  message         text NOT NULL,
  metadata        jsonb,
  ip_address      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_creditclock.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log: owner read"
  ON app_creditclock.audit_log
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "audit_log: anyone insert"
  ON app_creditclock.audit_log
  FOR INSERT
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS audit_log_user_time_idx ON app_creditclock.audit_log (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_creditclock.notification_preferences (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score_updates         boolean NOT NULL DEFAULT true,
  utilization_alerts    boolean NOT NULL DEFAULT true,
  payment_reminders     boolean NOT NULL DEFAULT true,
  marketing_emails      boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_creditclock.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_preferences: owner access"
  ON app_creditclock.notification_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION app_creditclock.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON app_creditclock.profiles
  FOR EACH ROW EXECUTE FUNCTION app_creditclock.set_updated_at();

CREATE TRIGGER user_goals_updated_at
  BEFORE UPDATE ON app_creditclock.user_goals
  FOR EACH ROW EXECUTE FUNCTION app_creditclock.set_updated_at();

CREATE TRIGGER credit_accounts_updated_at
  BEFORE UPDATE ON app_creditclock.credit_accounts
  FOR EACH ROW EXECUTE FUNCTION app_creditclock.set_updated_at();

CREATE TRIGGER action_items_updated_at
  BEFORE UPDATE ON app_creditclock.action_items
  FOR EACH ROW EXECUTE FUNCTION app_creditclock.set_updated_at();

CREATE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON app_creditclock.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION app_creditclock.set_updated_at();

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_creditclock TO app_creditclock_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_creditclock TO app_creditclock_user;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_creditclock TO app_creditclock_user;
