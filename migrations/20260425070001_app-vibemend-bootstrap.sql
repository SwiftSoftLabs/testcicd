CREATE SCHEMA IF NOT EXISTS app_vibemend;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_vibemend_user') THEN
    CREATE ROLE app_vibemend_user LOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_vibemend_user;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_vibemend_user;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM app_vibemend_user;

REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM app_vibemend_user;

GRANT USAGE, CREATE ON SCHEMA app_vibemend TO app_vibemend_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_vibemend TO app_vibemend_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_vibemend TO app_vibemend_user;

GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app_vibemend TO app_vibemend_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_vibemend
GRANT ALL PRIVILEGES ON TABLES TO app_vibemend_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_vibemend
GRANT ALL PRIVILEGES ON SEQUENCES TO app_vibemend_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_vibemend
GRANT ALL PRIVILEGES ON FUNCTIONS TO app_vibemend_user;

ALTER ROLE app_vibemend_user SET search_path TO app_vibemend;

DO $$
DECLARE
  schema_name text;
BEGIN
  FOR schema_name IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname LIKE 'app\_%'
      AND nspname <> 'app_vibemend'
  LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM app_vibemend_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM app_vibemend_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM app_vibemend_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM app_vibemend_user', schema_name);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION app_vibemend.ensure_app_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.raw_user_meta_data IS NULL THEN
    NEW.raw_user_meta_data := '{}'::jsonb;
  END IF;

  NEW.raw_user_meta_data :=
    jsonb_set(NEW.raw_user_meta_data, '{app_origin}', to_jsonb('app_vibemend'::text), true);

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_app_vibemend_set_app_origin ON auth.users;

CREATE TRIGGER trg_app_vibemend_set_app_origin
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION app_vibemend.ensure_app_origin();
