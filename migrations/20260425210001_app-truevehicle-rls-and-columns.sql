ALTER TABLE app_truevehicle.vehicles
ADD COLUMN IF NOT EXISTS image_url text,
ADD COLUMN IF NOT EXISTS mileage integer NOT NULL DEFAULT 0;

ALTER TABLE app_truevehicle.user_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_truevehicle.vehicles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_truevehicle.visual_analyses ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_truevehicle.vehicle_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_truevehicle.market_data ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_truevehicle.registration_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_truevehicle.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_truevehicle_user_profiles_self_all ON app_truevehicle.user_profiles;

CREATE POLICY app_truevehicle_user_profiles_self_all
ON app_truevehicle.user_profiles
FOR ALL TO public
USING ((user_id)::text = public.jwt_sub() OR public.is_max_member())
WITH CHECK ((user_id)::text = public.jwt_sub() OR public.is_max_member());

DROP POLICY IF EXISTS app_truevehicle_vehicle_reports_self_all ON app_truevehicle.vehicle_reports;

CREATE POLICY app_truevehicle_vehicle_reports_self_all
ON app_truevehicle.vehicle_reports
FOR ALL TO public
USING ((user_id)::text = public.jwt_sub() OR public.is_max_member())
WITH CHECK ((user_id)::text = public.jwt_sub() OR public.is_max_member());

DROP POLICY IF EXISTS app_truevehicle_audit_logs_self_select ON app_truevehicle.audit_logs;

CREATE POLICY app_truevehicle_audit_logs_self_select
ON app_truevehicle.audit_logs
FOR SELECT TO public
USING ((user_id)::text = public.jwt_sub() OR public.is_max_member());

DROP POLICY IF EXISTS app_truevehicle_vehicles_auth_read ON app_truevehicle.vehicles;

CREATE POLICY app_truevehicle_vehicles_auth_read
ON app_truevehicle.vehicles
FOR SELECT TO public
USING (public.jwt_sub() IS NOT NULL OR public.is_max_member());

DROP POLICY IF EXISTS app_truevehicle_vehicles_auth_write ON app_truevehicle.vehicles;

CREATE POLICY app_truevehicle_vehicles_auth_write
ON app_truevehicle.vehicles
FOR INSERT TO public
WITH CHECK (public.jwt_sub() IS NOT NULL OR public.is_max_member());

DROP POLICY IF EXISTS app_truevehicle_visual_analyses_auth_all ON app_truevehicle.visual_analyses;

CREATE POLICY app_truevehicle_visual_analyses_auth_all
ON app_truevehicle.visual_analyses
FOR ALL TO public
USING (public.jwt_sub() IS NOT NULL OR public.is_max_member())
WITH CHECK (public.jwt_sub() IS NOT NULL OR public.is_max_member());

DROP POLICY IF EXISTS app_truevehicle_market_data_auth_all ON app_truevehicle.market_data;

CREATE POLICY app_truevehicle_market_data_auth_all
ON app_truevehicle.market_data
FOR ALL TO public
USING (public.jwt_sub() IS NOT NULL OR public.is_max_member())
WITH CHECK (public.jwt_sub() IS NOT NULL OR public.is_max_member());

DROP POLICY IF EXISTS app_truevehicle_registration_events_auth_all ON app_truevehicle.registration_events;

CREATE POLICY app_truevehicle_registration_events_auth_all
ON app_truevehicle.registration_events
FOR ALL TO public
USING (public.jwt_sub() IS NOT NULL OR public.is_max_member())
WITH CHECK (public.jwt_sub() IS NOT NULL OR public.is_max_member());

DROP POLICY IF EXISTS app_truevehicle_audit_logs_insert_self ON app_truevehicle.audit_logs;

CREATE POLICY app_truevehicle_audit_logs_insert_self
ON app_truevehicle.audit_logs
FOR INSERT TO public
WITH CHECK ((user_id)::text = public.jwt_sub() OR public.is_max_member());
