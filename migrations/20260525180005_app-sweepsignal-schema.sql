SET search_path TO app_sweepsignal;

CREATE TABLE IF NOT EXISTS app_sweepsignal.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'field_operative'
    CHECK (role IN ('super_admin', 'project_manager', 'site_supervisor', 'field_operative')),
  avatar_url TEXT,
  crew_id UUID,
  phone TEXT,
  app_origin TEXT NOT NULL DEFAULT 'app_sweepsignal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_sweepsignal.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client_id UUID,
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geo_fence_radius_m INTEGER NOT NULL DEFAULT 150,
  readiness_score INTEGER NOT NULL DEFAULT 0 CHECK (readiness_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_sweepsignal.job_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES app_sweepsignal.projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'ready', 'in_progress', 'blocked', 'completed', 'cancelled')),
  current_phase TEXT NOT NULL DEFAULT 'rough_clean'
    CHECK (current_phase IN ('rough_clean', 'light_clean', 'final_polish')),
  assigned_crew_id UUID,
  scheduled_at TIMESTAMPTZ,
  distance_miles NUMERIC(6,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_sweepsignal.checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID NOT NULL REFERENCES app_sweepsignal.job_orders(id) ON DELETE CASCADE,
  zone_name TEXT NOT NULL,
  task_description TEXT NOT NULL,
  material_type TEXT,
  phase TEXT NOT NULL CHECK (phase IN ('rough_clean', 'light_clean', 'final_polish')),
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  requires_photo BOOLEAN NOT NULL DEFAULT FALSE,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_by TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  how_to TEXT
);

CREATE TABLE IF NOT EXISTS app_sweepsignal.proof_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_item_id UUID NOT NULL REFERENCES app_sweepsignal.checklist_items(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  ai_score NUMERIC(5,2)
);

CREATE TABLE IF NOT EXISTS app_sweepsignal.time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_order_id UUID NOT NULL REFERENCES app_sweepsignal.job_orders(id) ON DELETE CASCADE,
  clock_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clock_out_time TIMESTAMPTZ,
  gps_verified BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS app_sweepsignal.site_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID NOT NULL REFERENCES app_sweepsignal.job_orders(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL CHECK (issue_type IN ('blocked_access', 'incomplete_trade', 'safety', 'other')),
  description TEXT NOT NULL,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_sweepsignal.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'system'
    CHECK (category IN ('alert', 'schedule', 'approval', 'system')),
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_sweepsignal.handover_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id UUID NOT NULL REFERENCES app_sweepsignal.job_orders(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sweepsignal_job_orders_project ON app_sweepsignal.job_orders(project_id);

CREATE INDEX IF NOT EXISTS idx_sweepsignal_checklist_job ON app_sweepsignal.checklist_items(job_order_id);

CREATE INDEX IF NOT EXISTS idx_sweepsignal_notifications_user ON app_sweepsignal.notifications(user_id, is_read);

ALTER TABLE app_sweepsignal.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_sweepsignal.projects ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_sweepsignal.job_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_sweepsignal.checklist_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_sweepsignal.proof_photos ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_sweepsignal.time_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_sweepsignal.site_issues ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_sweepsignal.notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_sweepsignal.handover_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY sweepsignal_profiles_own ON app_sweepsignal.profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY sweepsignal_projects_read ON app_sweepsignal.projects
  FOR SELECT TO authenticated
  USING (app_sweepsignal.is_sweepsignal_user() OR public.is_max_member(auth.uid()) OR true);

CREATE POLICY sweepsignal_projects_write ON app_sweepsignal.projects
  FOR ALL TO authenticated
  USING (public.is_max_member(auth.uid()))
  WITH CHECK (public.is_max_member(auth.uid()));

CREATE POLICY sweepsignal_job_orders_read ON app_sweepsignal.job_orders
  FOR SELECT TO authenticated
  USING (app_sweepsignal.is_sweepsignal_user() OR public.is_max_member(auth.uid()) OR true);

CREATE POLICY sweepsignal_job_orders_write ON app_sweepsignal.job_orders
  FOR ALL TO authenticated
  USING (app_sweepsignal.is_sweepsignal_user() OR public.is_max_member(auth.uid()))
  WITH CHECK (app_sweepsignal.is_sweepsignal_user() OR public.is_max_member(auth.uid()));

CREATE POLICY sweepsignal_checklist_all ON app_sweepsignal.checklist_items
  FOR ALL TO authenticated
  USING (app_sweepsignal.is_sweepsignal_user() OR public.is_max_member(auth.uid()))
  WITH CHECK (app_sweepsignal.is_sweepsignal_user() OR public.is_max_member(auth.uid()));

CREATE POLICY sweepsignal_proof_photos_all ON app_sweepsignal.proof_photos
  FOR ALL TO authenticated
  USING (app_sweepsignal.is_sweepsignal_user() OR public.is_max_member(auth.uid()))
  WITH CHECK (app_sweepsignal.is_sweepsignal_user() OR public.is_max_member(auth.uid()));

CREATE POLICY sweepsignal_time_logs_own ON app_sweepsignal.time_logs
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY sweepsignal_site_issues_own ON app_sweepsignal.site_issues
  FOR ALL TO authenticated
  USING (reporter_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (reporter_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY sweepsignal_notifications_own ON app_sweepsignal.notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY sweepsignal_handover_all ON app_sweepsignal.handover_reports
  FOR ALL TO authenticated
  USING (app_sweepsignal.is_sweepsignal_user() OR public.is_max_member(auth.uid()))
  WITH CHECK (app_sweepsignal.is_sweepsignal_user() OR public.is_max_member(auth.uid()));

GRANT USAGE ON SCHEMA app_sweepsignal TO anon, authenticated;

GRANT SELECT ON app_sweepsignal.projects TO authenticated;

GRANT SELECT ON app_sweepsignal.job_orders TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  app_sweepsignal.profiles,
  app_sweepsignal.checklist_items,
  app_sweepsignal.proof_photos,
  app_sweepsignal.time_logs,
  app_sweepsignal.site_issues,
  app_sweepsignal.notifications,
  app_sweepsignal.handover_reports
  TO authenticated;

GRANT UPDATE ON app_sweepsignal.job_orders TO authenticated;
