DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_voxaura_user') THEN
    CREATE ROLE app_voxaura_user LOGIN PASSWORD 'va_app_voxaura_2026!Locked';
  END IF;
END $$;

REVOKE ALL ON DATABASE insforge FROM app_voxaura_user;

GRANT CONNECT ON DATABASE insforge TO app_voxaura_user;

REVOKE ALL ON SCHEMA public FROM app_voxaura_user;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_voxaura_user;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_voxaura_user;

GRANT USAGE ON SCHEMA app_voxaura TO app_voxaura_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_voxaura TO app_voxaura_user;

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA app_voxaura TO app_voxaura_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_voxaura
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_voxaura_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_voxaura
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_voxaura_user;

ALTER ROLE app_voxaura_user IN DATABASE insforge SET search_path = app_voxaura;
