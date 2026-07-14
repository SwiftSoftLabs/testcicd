CREATE SCHEMA IF NOT EXISTS app_sweepsignal;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_sweepsignal_user') THEN
    CREATE ROLE app_sweepsignal_user LOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_sweepsignal_user;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_sweepsignal_user;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM app_sweepsignal_user;

REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM app_sweepsignal_user;

GRANT USAGE, CREATE ON SCHEMA app_sweepsignal TO app_sweepsignal_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_sweepsignal TO app_sweepsignal_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_sweepsignal TO app_sweepsignal_user;

GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app_sweepsignal TO app_sweepsignal_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_sweepsignal
  GRANT ALL PRIVILEGES ON TABLES TO app_sweepsignal_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_sweepsignal
  GRANT ALL PRIVILEGES ON SEQUENCES TO app_sweepsignal_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_sweepsignal
  GRANT ALL PRIVILEGES ON FUNCTIONS TO app_sweepsignal_user;

ALTER ROLE app_sweepsignal_user SET search_path TO app_sweepsignal;

DO $$
DECLARE
  schema_name text;
BEGIN
  FOR schema_name IN
    SELECT nspname FROM pg_namespace
    WHERE nspname LIKE 'app\_%' AND nspname <> 'app_sweepsignal'
  LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM app_sweepsignal_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM app_sweepsignal_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM app_sweepsignal_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM app_sweepsignal_user', schema_name);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.tag_sweepsignal_app_origin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
DECLARE
  uid uuid;
  current_origin text;
  new_meta jsonb;
BEGIN
  uid := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'tag_sweepsignal_app_origin: no authenticated user';
  END IF;

  SELECT metadata ->> 'app_origin' INTO current_origin
  FROM auth.users WHERE id = uid;

  IF current_origin = 'app_sweepsignal' THEN
    RETURN jsonb_build_object('app_origin', current_origin, 'updated', false);
  END IF;

  IF current_origin IS NOT NULL AND current_origin <> 'app_sweepsignal' THEN
    RETURN jsonb_build_object('app_origin', current_origin, 'updated', false);
  END IF;

  UPDATE auth.users
     SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"app_origin":"app_sweepsignal"}'::jsonb
   WHERE id = uid
   RETURNING metadata INTO new_meta;

  RETURN jsonb_build_object('app_origin', new_meta ->> 'app_origin', 'updated', true);
END;
$$;

REVOKE ALL ON FUNCTION public.tag_sweepsignal_app_origin() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.tag_sweepsignal_app_origin() TO authenticated;

GRANT EXECUTE ON FUNCTION public.tag_sweepsignal_app_origin() TO app_sweepsignal_user;

CREATE OR REPLACE FUNCTION app_sweepsignal.is_sweepsignal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      AND metadata ->> 'app_origin' = 'app_sweepsignal'
  );
$$;

GRANT EXECUTE ON FUNCTION app_sweepsignal.is_sweepsignal_user() TO authenticated, anon, app_sweepsignal_user;
