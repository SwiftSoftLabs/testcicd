CREATE TABLE IF NOT EXISTS app_vibemend.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('client', 'expert')),
  display_name text NOT NULL,
  avatar_url text,
  bio text,
  tagline text,
  tools text[] NOT NULL DEFAULT '{}',
  skills text[] NOT NULL DEFAULT '{}',
  hourly_rate numeric(10,2) NOT NULL DEFAULT 0,
  rating numeric(3,2) NOT NULL DEFAULT 5.0,
  review_count integer NOT NULL DEFAULT 0,
  is_online boolean NOT NULL DEFAULT false,
  stripe_account_id text,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_vibemend.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expert_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  tool text NOT NULL,
  stack text NOT NULL,
  issue_description text NOT NULL,
  ai_summary text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'active', 'completed', 'cancelled', 'disputed')),
  room_url text,
  estimated_cost numeric(10,2) NOT NULL DEFAULT 0,
  final_cost numeric(10,2) NOT NULL DEFAULT 0,
  platform_fee numeric(10,2) NOT NULL DEFAULT 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_vibemend.session_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES app_vibemend.sessions(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'code_snippet', 'system_alert')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_vibemend.saved_experts (
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expert_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, expert_id)
);

CREATE INDEX IF NOT EXISTS idx_profiles_role_online ON app_vibemend.profiles(role, is_online);

CREATE INDEX IF NOT EXISTS idx_profiles_skills_gin ON app_vibemend.profiles USING gin(skills);

CREATE INDEX IF NOT EXISTS idx_profiles_tools_gin ON app_vibemend.profiles USING gin(tools);

CREATE INDEX IF NOT EXISTS idx_sessions_client_id ON app_vibemend.sessions(client_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expert_id ON app_vibemend.sessions(expert_id);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON app_vibemend.sessions(status);

CREATE INDEX IF NOT EXISTS idx_messages_session_created ON app_vibemend.session_messages(session_id, created_at DESC);

CREATE OR REPLACE FUNCTION app_vibemend.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_profiles_touch_updated_at ON app_vibemend.profiles;

CREATE TRIGGER trg_profiles_touch_updated_at
BEFORE UPDATE ON app_vibemend.profiles
FOR EACH ROW
EXECUTE FUNCTION app_vibemend.touch_updated_at();

DROP TRIGGER IF EXISTS trg_sessions_touch_updated_at ON app_vibemend.sessions;

CREATE TRIGGER trg_sessions_touch_updated_at
BEFORE UPDATE ON app_vibemend.sessions
FOR EACH ROW
EXECUTE FUNCTION app_vibemend.touch_updated_at();
