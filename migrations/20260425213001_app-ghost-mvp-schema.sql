CREATE SCHEMA IF NOT EXISTS app_ghost;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ghost_user') THEN
    CREATE ROLE app_ghost_user LOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_ghost_user;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_ghost_user;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM app_ghost_user;

REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM app_ghost_user;

GRANT USAGE, CREATE ON SCHEMA app_ghost TO app_ghost_user;

ALTER ROLE app_ghost_user SET search_path TO app_ghost;

DO $$
DECLARE
  schema_name text;
BEGIN
  FOR schema_name IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname LIKE 'app\_%'
      AND nspname <> 'app_ghost'
  LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM app_ghost_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM app_ghost_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM app_ghost_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM app_ghost_user', schema_name);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION app_ghost.is_max_member()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result boolean := false;
BEGIN
  IF to_regproc('public.is_max_member') IS NOT NULL THEN
    EXECUTE 'SELECT public.is_max_member()' INTO result;
  END IF;
  RETURN COALESCE(result, false);
END
$$;

CREATE TABLE IF NOT EXISTS app_ghost.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  full_name text,
  tier text NOT NULL DEFAULT 'core' CHECK (tier IN ('core', 'max')),
  app_origin text NOT NULL DEFAULT 'app_ghost',
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_ghost.concierge_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_type text NOT NULL DEFAULT 'general',
  prompt text NOT NULL,
  transcript text,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'clarification_needed', 'approved', 'in_progress', 'completed', 'rejected', 'cancelled')),
  ai_confidence numeric(5, 4) NOT NULL DEFAULT 0,
  urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high', 'critical')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_ghost.request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES app_ghost.concierge_requests(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type text NOT NULL DEFAULT 'system' CHECK (actor_type IN ('system', 'ai', 'human_agent', 'user')),
  event_type text NOT NULL,
  note text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_ghost.wallet_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance numeric(14, 2) NOT NULL DEFAULT 100000,
  currency text NOT NULL DEFAULT 'USD',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_ghost.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid REFERENCES app_ghost.concierge_requests(id) ON DELETE SET NULL,
  direction text NOT NULL DEFAULT 'debit' CHECK (direction IN ('debit', 'credit')),
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  category text NOT NULL DEFAULT 'concierge',
  description text NOT NULL,
  status text NOT NULL DEFAULT 'settled' CHECK (status IN ('pending', 'settled', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_ghost.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  aviation jsonb NOT NULL DEFAULT '{}'::jsonb,
  cuisine jsonb NOT NULL DEFAULT '{}'::jsonb,
  hospitality jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_ghost.security_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  biometric_access boolean NOT NULL DEFAULT true,
  voice_liveness boolean NOT NULL DEFAULT true,
  ghost_mode boolean NOT NULL DEFAULT false,
  location_cloaking boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_ghost_requests_user_created ON app_ghost.concierge_requests(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_ghost_request_events_request_created ON app_ghost.request_events(request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_ghost_wallet_transactions_user_created ON app_ghost.wallet_transactions(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION app_ghost.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_app_ghost_profiles_touch_updated_at ON app_ghost.profiles;

CREATE TRIGGER trg_app_ghost_profiles_touch_updated_at
BEFORE UPDATE ON app_ghost.profiles
FOR EACH ROW
EXECUTE FUNCTION app_ghost.touch_updated_at();

DROP TRIGGER IF EXISTS trg_app_ghost_requests_touch_updated_at ON app_ghost.concierge_requests;

CREATE TRIGGER trg_app_ghost_requests_touch_updated_at
BEFORE UPDATE ON app_ghost.concierge_requests
FOR EACH ROW
EXECUTE FUNCTION app_ghost.touch_updated_at();

DROP TRIGGER IF EXISTS trg_app_ghost_wallet_accounts_touch_updated_at ON app_ghost.wallet_accounts;

CREATE TRIGGER trg_app_ghost_wallet_accounts_touch_updated_at
BEFORE UPDATE ON app_ghost.wallet_accounts
FOR EACH ROW
EXECUTE FUNCTION app_ghost.touch_updated_at();

DROP TRIGGER IF EXISTS trg_app_ghost_user_preferences_touch_updated_at ON app_ghost.user_preferences;

CREATE TRIGGER trg_app_ghost_user_preferences_touch_updated_at
BEFORE UPDATE ON app_ghost.user_preferences
FOR EACH ROW
EXECUTE FUNCTION app_ghost.touch_updated_at();

DROP TRIGGER IF EXISTS trg_app_ghost_security_settings_touch_updated_at ON app_ghost.security_settings;

CREATE TRIGGER trg_app_ghost_security_settings_touch_updated_at
BEFORE UPDATE ON app_ghost.security_settings
FOR EACH ROW
EXECUTE FUNCTION app_ghost.touch_updated_at();

CREATE OR REPLACE FUNCTION app_ghost.seed_user_records(new_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO app_ghost.wallet_accounts (user_id)
  VALUES (new_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO app_ghost.user_preferences (user_id)
  VALUES (new_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO app_ghost.security_settings (user_id)
  VALUES (new_user_id)
  ON CONFLICT (user_id) DO NOTHING;
END
$$;

CREATE OR REPLACE FUNCTION app_ghost.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_ghost
AS $$
DECLARE
  inferred_origin text;
BEGIN
  inferred_origin := COALESCE(NEW.raw_user_meta_data ->> 'app_origin', '');
  IF inferred_origin = 'app_ghost' THEN
    INSERT INTO app_ghost.profiles (id, email, full_name, app_origin)
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''),
      'app_ghost'
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        app_origin = 'app_ghost';

    PERFORM app_ghost.seed_user_records(NEW.id);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_app_ghost ON auth.users;

CREATE TRIGGER on_auth_user_created_app_ghost
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION app_ghost.handle_new_user();

ALTER TABLE app_ghost.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_ghost.concierge_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_ghost.request_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_ghost.wallet_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_ghost.wallet_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_ghost.user_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_ghost.security_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_own ON app_ghost.profiles;

CREATE POLICY profiles_own ON app_ghost.profiles
FOR ALL TO authenticated
USING (id = auth.uid() OR app_ghost.is_max_member())
WITH CHECK (id = auth.uid() OR app_ghost.is_max_member());

DROP POLICY IF EXISTS requests_own ON app_ghost.concierge_requests;

CREATE POLICY requests_own ON app_ghost.concierge_requests
FOR ALL TO authenticated
USING (user_id = auth.uid() OR app_ghost.is_max_member())
WITH CHECK (user_id = auth.uid() OR app_ghost.is_max_member());

DROP POLICY IF EXISTS request_events_visible ON app_ghost.request_events;

CREATE POLICY request_events_visible ON app_ghost.request_events
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM app_ghost.concierge_requests r
    WHERE r.id = request_id
      AND (r.user_id = auth.uid() OR app_ghost.is_max_member())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM app_ghost.concierge_requests r
    WHERE r.id = request_id
      AND (r.user_id = auth.uid() OR app_ghost.is_max_member())
  )
);

DROP POLICY IF EXISTS wallet_accounts_own ON app_ghost.wallet_accounts;

CREATE POLICY wallet_accounts_own ON app_ghost.wallet_accounts
FOR ALL TO authenticated
USING (user_id = auth.uid() OR app_ghost.is_max_member())
WITH CHECK (user_id = auth.uid() OR app_ghost.is_max_member());

DROP POLICY IF EXISTS wallet_transactions_own ON app_ghost.wallet_transactions;

CREATE POLICY wallet_transactions_own ON app_ghost.wallet_transactions
FOR ALL TO authenticated
USING (user_id = auth.uid() OR app_ghost.is_max_member())
WITH CHECK (user_id = auth.uid() OR app_ghost.is_max_member());

DROP POLICY IF EXISTS preferences_own ON app_ghost.user_preferences;

CREATE POLICY preferences_own ON app_ghost.user_preferences
FOR ALL TO authenticated
USING (user_id = auth.uid() OR app_ghost.is_max_member())
WITH CHECK (user_id = auth.uid() OR app_ghost.is_max_member());

DROP POLICY IF EXISTS security_settings_own ON app_ghost.security_settings;

CREATE POLICY security_settings_own ON app_ghost.security_settings
FOR ALL TO authenticated
USING (user_id = auth.uid() OR app_ghost.is_max_member())
WITH CHECK (user_id = auth.uid() OR app_ghost.is_max_member());

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_ghost TO app_ghost_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_ghost TO app_ghost_user;

GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app_ghost TO app_ghost_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_ghost
GRANT ALL PRIVILEGES ON TABLES TO app_ghost_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_ghost
GRANT ALL PRIVILEGES ON SEQUENCES TO app_ghost_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_ghost
GRANT ALL PRIVILEGES ON FUNCTIONS TO app_ghost_user;
