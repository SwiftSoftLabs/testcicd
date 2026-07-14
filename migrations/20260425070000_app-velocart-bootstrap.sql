CREATE SCHEMA IF NOT EXISTS app_velocart;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_velocart_user') THEN
    CREATE ROLE app_velocart_user;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_velocart_user;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_velocart_user;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM app_velocart_user;

REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM app_velocart_user;

DO $$
DECLARE s text;
BEGIN
  FOR s IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname LIKE 'app_%'
      AND nspname <> 'app_velocart'
  LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM app_velocart_user', s);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM app_velocart_user', s);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM app_velocart_user', s);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM app_velocart_user', s);
  END LOOP;
END
$$;

GRANT USAGE, CREATE ON SCHEMA app_velocart TO app_velocart_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_velocart TO app_velocart_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_velocart TO app_velocart_user;

GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app_velocart TO app_velocart_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_velocart GRANT ALL PRIVILEGES ON TABLES TO app_velocart_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_velocart GRANT ALL PRIVILEGES ON SEQUENCES TO app_velocart_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_velocart GRANT ALL PRIVILEGES ON FUNCTIONS TO app_velocart_user;

ALTER ROLE app_velocart_user SET search_path TO app_velocart;

CREATE TABLE IF NOT EXISTS app_velocart.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_velocart_user_profiles_created_at
  ON app_velocart.user_profiles (created_at DESC);

CREATE OR REPLACE FUNCTION app_velocart.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_velocart_user_profiles_touch_updated_at
  ON app_velocart.user_profiles;

CREATE TRIGGER trg_app_velocart_user_profiles_touch_updated_at
BEFORE UPDATE ON app_velocart.user_profiles
FOR EACH ROW
EXECUTE FUNCTION app_velocart.touch_updated_at();
