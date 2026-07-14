CREATE SCHEMA IF NOT EXISTS app_nullify;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_nullify_user') THEN
    CREATE ROLE app_nullify_user NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE app_nullify_user SET search_path = app_nullify;

REVOKE ALL ON SCHEMA public FROM app_nullify_user;

DO $$
DECLARE
  schema_name text;
BEGIN
  FOR schema_name IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname LIKE 'app\_%' ESCAPE '\'
      AND nspname <> 'app_nullify'
  LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM app_nullify_user', schema_name);
  END LOOP;
END
$$;

GRANT USAGE ON SCHEMA app_nullify TO app_nullify_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_nullify TO app_nullify_user;

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA app_nullify TO app_nullify_user;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_nullify TO app_nullify_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_nullify
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_nullify_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_nullify
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_nullify_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_nullify
GRANT EXECUTE ON FUNCTIONS TO app_nullify_user;
