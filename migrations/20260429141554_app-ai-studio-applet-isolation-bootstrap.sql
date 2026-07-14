DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ai_studio_applet_user') THEN
    CREATE ROLE app_ai_studio_applet_user NOINHERIT;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app_ai_studio_applet;

REVOKE ALL ON SCHEMA public FROM app_ai_studio_applet_user;

GRANT USAGE, CREATE ON SCHEMA app_ai_studio_applet TO app_ai_studio_applet_user;

ALTER ROLE app_ai_studio_applet_user SET search_path TO app_ai_studio_applet;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_ai_studio_applet
GRANT ALL PRIVILEGES ON TABLES TO app_ai_studio_applet_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_ai_studio_applet TO app_ai_studio_applet_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_ai_studio_applet TO app_ai_studio_applet_user;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_ai_studio_applet TO app_ai_studio_applet_user;

CREATE OR REPLACE FUNCTION app_ai_studio_applet.is_max_member_safe()
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

CREATE TABLE IF NOT EXISTS app_ai_studio_applet.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  app_origin text NOT NULL DEFAULT 'app_ai_studio_applet',
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_app_origin_check CHECK (app_origin = 'app_ai_studio_applet')
);

ALTER TABLE app_ai_studio_applet.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_select ON app_ai_studio_applet.user_profiles;

CREATE POLICY user_profiles_select
ON app_ai_studio_applet.user_profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id OR app_ai_studio_applet.is_max_member_safe()
);

DROP POLICY IF EXISTS user_profiles_insert ON app_ai_studio_applet.user_profiles;

CREATE POLICY user_profiles_insert
ON app_ai_studio_applet.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND app_origin = 'app_ai_studio_applet'
);

DROP POLICY IF EXISTS user_profiles_update ON app_ai_studio_applet.user_profiles;

CREATE POLICY user_profiles_update
ON app_ai_studio_applet.user_profiles
FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id OR app_ai_studio_applet.is_max_member_safe()
)
WITH CHECK (
  (auth.uid() = user_id OR app_ai_studio_applet.is_max_member_safe())
  AND app_origin = 'app_ai_studio_applet'
);

DROP POLICY IF EXISTS user_profiles_delete ON app_ai_studio_applet.user_profiles;

CREATE POLICY user_profiles_delete
ON app_ai_studio_applet.user_profiles
FOR DELETE
TO authenticated
USING (
  auth.uid() = user_id OR app_ai_studio_applet.is_max_member_safe()
);
