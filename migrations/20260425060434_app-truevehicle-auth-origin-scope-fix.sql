DROP TRIGGER IF EXISTS trg_enforce_truevehicle_app_origin ON auth.users;

DROP FUNCTION IF EXISTS public.enforce_truevehicle_app_origin();

CREATE OR REPLACE FUNCTION app_truevehicle.with_app_origin(input_metadata jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(input_metadata, '{}'::jsonb) || '{"app_origin":"app_truevehicle"}'::jsonb;
$$;
