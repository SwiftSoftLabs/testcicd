DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_truevehicle_user') THEN
    CREATE ROLE app_truevehicle_user LOGIN;
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM app_truevehicle_user;

REVOKE ALL ON SCHEMA app_truevehicle FROM PUBLIC;

GRANT USAGE, CREATE ON SCHEMA app_truevehicle TO app_truevehicle_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_truevehicle TO app_truevehicle_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_truevehicle TO app_truevehicle_user;

GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app_truevehicle TO app_truevehicle_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_truevehicle
GRANT ALL PRIVILEGES ON TABLES TO app_truevehicle_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_truevehicle
GRANT ALL PRIVILEGES ON SEQUENCES TO app_truevehicle_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_truevehicle
GRANT ALL PRIVILEGES ON FUNCTIONS TO app_truevehicle_user;

ALTER ROLE app_truevehicle_user SET search_path TO app_truevehicle;
