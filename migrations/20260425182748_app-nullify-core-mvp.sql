CREATE SCHEMA IF NOT EXISTS app_nullify;

CREATE OR REPLACE FUNCTION app_nullify.is_max_member()
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
END;
$$;

CREATE TABLE IF NOT EXISTS app_nullify.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  app_origin text NOT NULL DEFAULT 'app_nullify',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_nullify.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_nullify.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  provider text NOT NULL,
  model_name text,
  endpoint_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'paused', 'draft')),
  daily_token_quota integer NOT NULL DEFAULT 100000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_nullify.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  action text NOT NULL CHECK (action IN ('approve', 'block', 'flag', 'escalate')),
  priority integer NOT NULL DEFAULT 1,
  is_deployed boolean NOT NULL DEFAULT false,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_nullify.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES app_nullify.agents(id) ON DELETE SET NULL,
  decision_type text NOT NULL,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'blocked', 'flagged', 'rewritten')),
  intervention_action text NOT NULL DEFAULT 'allow' CHECK (intervention_action IN ('allow', 'rewrite', 'block', 'escalate')),
  latency_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_nullify.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_nullify.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_nullify.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app_nullify.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON app_nullify.profiles;

CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON app_nullify.profiles
FOR EACH ROW
EXECUTE FUNCTION app_nullify.handle_updated_at();

DROP TRIGGER IF EXISTS set_agents_updated_at ON app_nullify.agents;

CREATE TRIGGER set_agents_updated_at
BEFORE UPDATE ON app_nullify.agents
FOR EACH ROW
EXECUTE FUNCTION app_nullify.handle_updated_at();

DROP TRIGGER IF EXISTS set_policies_updated_at ON app_nullify.policies;

CREATE TRIGGER set_policies_updated_at
BEFORE UPDATE ON app_nullify.policies
FOR EACH ROW
EXECUTE FUNCTION app_nullify.handle_updated_at();

CREATE OR REPLACE FUNCTION app_nullify.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_nullify
AS $$
BEGIN
  INSERT INTO app_nullify.profiles (id, email, full_name, app_origin, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'app_origin', 'app_nullify'),
    'admin'
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      app_origin = EXCLUDED.app_origin;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_app_nullify ON auth.users;

CREATE TRIGGER on_auth_user_created_app_nullify
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION app_nullify.handle_new_user();

ALTER TABLE app_nullify.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_nullify.agents ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_nullify.policies ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_nullify.decisions ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_nullify.alerts ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_nullify.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON app_nullify.profiles;

CREATE POLICY profiles_select ON app_nullify.profiles
FOR SELECT
USING (auth.uid() = id OR app_nullify.is_max_member());

DROP POLICY IF EXISTS profiles_update ON app_nullify.profiles;

CREATE POLICY profiles_update ON app_nullify.profiles
FOR UPDATE
USING (auth.uid() = id OR app_nullify.is_max_member())
WITH CHECK (auth.uid() = id OR app_nullify.is_max_member());

DROP POLICY IF EXISTS agents_all ON app_nullify.agents;

CREATE POLICY agents_all ON app_nullify.agents
FOR ALL
USING (owner_id = auth.uid() OR app_nullify.is_max_member())
WITH CHECK (owner_id = auth.uid() OR app_nullify.is_max_member());

DROP POLICY IF EXISTS policies_select ON app_nullify.policies;

CREATE POLICY policies_select ON app_nullify.policies
FOR SELECT
USING (true);

DROP POLICY IF EXISTS policies_write ON app_nullify.policies;

CREATE POLICY policies_write ON app_nullify.policies
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM app_nullify.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor')
  ) OR app_nullify.is_max_member()
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM app_nullify.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor')
  ) OR app_nullify.is_max_member()
);

DROP POLICY IF EXISTS decisions_select ON app_nullify.decisions;

CREATE POLICY decisions_select ON app_nullify.decisions
FOR SELECT
USING (true);

DROP POLICY IF EXISTS decisions_write ON app_nullify.decisions;

CREATE POLICY decisions_write ON app_nullify.decisions
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM app_nullify.agents a
    WHERE a.id = agent_id AND (a.owner_id = auth.uid() OR app_nullify.is_max_member())
  )
);

DROP POLICY IF EXISTS alerts_select ON app_nullify.alerts;

CREATE POLICY alerts_select ON app_nullify.alerts
FOR SELECT
USING (true);

DROP POLICY IF EXISTS alerts_write ON app_nullify.alerts;

CREATE POLICY alerts_write ON app_nullify.alerts
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM app_nullify.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor')
  ) OR app_nullify.is_max_member()
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM app_nullify.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor')
  ) OR app_nullify.is_max_member()
);

DROP POLICY IF EXISTS notifications_own ON app_nullify.notifications;

CREATE POLICY notifications_own ON app_nullify.notifications
FOR ALL
USING (user_id = auth.uid() OR app_nullify.is_max_member())
WITH CHECK (user_id = auth.uid() OR app_nullify.is_max_member());
