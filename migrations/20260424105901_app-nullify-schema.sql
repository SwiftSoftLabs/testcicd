CREATE SCHEMA IF NOT EXISTS app_nullify;

GRANT USAGE ON SCHEMA app_nullify TO anon, authenticated, project_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_nullify
GRANT ALL ON TABLES TO project_admin;
