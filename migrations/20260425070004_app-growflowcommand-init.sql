CREATE SCHEMA IF NOT EXISTS app_growflowcommand;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_growflowcommand_user') THEN
    CREATE ROLE app_growflowcommand_user;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_growflowcommand_user;

GRANT USAGE, CREATE ON SCHEMA app_growflowcommand TO app_growflowcommand_user;

GRANT USAGE ON SCHEMA app_growflowcommand TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_growflowcommand
  GRANT ALL ON TABLES    TO app_growflowcommand_user;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_growflowcommand
  GRANT ALL ON SEQUENCES TO app_growflowcommand_user;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_growflowcommand
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_growflowcommand
  GRANT USAGE, SELECT                  ON SEQUENCES TO authenticated;

ALTER ROLE app_growflowcommand_user SET search_path TO app_growflowcommand;

CREATE TABLE app_growflowcommand.profiles (
  id           uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  app_origin   text DEFAULT NULL,
  email        text,
  full_name    text,
  avatar_url   text,
  first_name   text,
  last_name    text,
  company      text,
  phone_number text,
  timezone     text    DEFAULT 'America/New_York',
  language     text    DEFAULT 'en',
  date_format  text    DEFAULT 'mm/dd/yyyy',
  time_format  text    DEFAULT '12h',
  theme        text    DEFAULT 'light',
  compact_view      boolean DEFAULT false,
  usage_analytics   boolean DEFAULT true,
  auto_backup       boolean DEFAULT true,
  notification_preferences jsonb DEFAULT '{
    "email":       {"content_approval":true,"content_published":true,"weekly_summary":true},
    "sms":         {"urgent_only":false},
    "quiet_hours": {"start":"22:00","end":"08:00"}
  }'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL                       ON app_growflowcommand.profiles TO app_growflowcommand_user;

GRANT SELECT, INSERT, UPDATE    ON app_growflowcommand.profiles TO authenticated;

CREATE OR REPLACE FUNCTION app_growflowcommand.is_member(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = app_growflowcommand, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_growflowcommand.profiles
    WHERE id = _uid AND app_origin = 'app_growflowcommand'
  )
$$;

CREATE OR REPLACE FUNCTION app_growflowcommand.claim_user_origin(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_growflowcommand, auth, public
AS $$
BEGIN
  UPDATE auth.users
  SET    metadata = COALESCE(metadata, '{}'::jsonb)
                    || '{"app_origin":"app_growflowcommand"}'::jsonb
  WHERE  id = _user_id
    AND  (metadata->>'app_origin' IS NULL OR metadata->>'app_origin' = '');

  UPDATE app_growflowcommand.profiles
  SET    app_origin = 'app_growflowcommand'
  WHERE  id = _user_id
    AND  (app_origin IS NULL OR app_origin = '');
END;
$$;

REVOKE EXECUTE ON FUNCTION app_growflowcommand.claim_user_origin(uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION app_growflowcommand.claim_user_origin(uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION app_growflowcommand.claim_user_origin(uuid) FROM authenticated;

GRANT  EXECUTE ON FUNCTION app_growflowcommand.claim_user_origin(uuid) TO postgres;

ALTER TABLE app_growflowcommand.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_own_or_max ON app_growflowcommand.profiles
  FOR ALL
  USING  (auth.uid() = id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()))
  WITH CHECK (auth.uid() = id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()));

CREATE OR REPLACE FUNCTION app_growflowcommand.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_growflowcommand, pg_temp
AS $$
BEGIN
  INSERT INTO app_growflowcommand.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.profile->>'name',
      NEW.profile->>'full_name',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_growflowcommand
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_growflowcommand.handle_new_user();

CREATE TABLE app_growflowcommand.posts (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES app_growflowcommand.profiles(id) ON DELETE CASCADE,
  title         text NOT NULL,
  content       text,
  status        text DEFAULT 'draft',
  scheduled_for timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_growflowcommand.posts ENABLE ROW LEVEL SECURITY;

GRANT ALL                            ON app_growflowcommand.posts TO app_growflowcommand_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_growflowcommand.posts TO authenticated;

CREATE POLICY posts_own_or_max ON app_growflowcommand.posts
  FOR ALL
  USING  (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()))
  WITH CHECK (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()));

CREATE TABLE app_growflowcommand.content_pillars (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text,
  keywords         text[],
  target_platforms text[] DEFAULT ARRAY['LinkedIn','Twitter'],
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_growflowcommand.content_pillars ENABLE ROW LEVEL SECURITY;

GRANT ALL                            ON app_growflowcommand.content_pillars TO app_growflowcommand_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_growflowcommand.content_pillars TO authenticated;

CREATE POLICY content_pillars_own_or_max ON app_growflowcommand.content_pillars
  FOR ALL
  USING  (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()))
  WITH CHECK (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()));

CREATE TABLE app_growflowcommand.generated_content (
  id                   uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pillar_id            uuid REFERENCES app_growflowcommand.content_pillars(id) ON DELETE CASCADE,
  platform             text NOT NULL CHECK (platform IN ('LinkedIn','Twitter','Facebook','Instagram')),
  content              text NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected','published','scheduled')),
  scheduled_for        timestamptz,
  auto_schedule        boolean DEFAULT false,
  schedule_preferences jsonb DEFAULT '{}'::jsonb,
  image_url            text,
  engagement_metrics   jsonb DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  approved_at          timestamptz,
  published_at         timestamptz
);

ALTER TABLE app_growflowcommand.generated_content ENABLE ROW LEVEL SECURITY;

GRANT ALL                            ON app_growflowcommand.generated_content TO app_growflowcommand_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_growflowcommand.generated_content TO authenticated;

CREATE POLICY generated_content_own_or_max ON app_growflowcommand.generated_content
  FOR ALL
  USING  (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()))
  WITH CHECK (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()));

CREATE TABLE app_growflowcommand.content_approval_history (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content_id uuid NOT NULL REFERENCES app_growflowcommand.generated_content(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('approved','rejected','regenerated','edited')),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_growflowcommand.content_approval_history ENABLE ROW LEVEL SECURITY;

GRANT ALL                       ON app_growflowcommand.content_approval_history TO app_growflowcommand_user;

GRANT SELECT, INSERT            ON app_growflowcommand.content_approval_history TO authenticated;

CREATE POLICY content_approval_history_own_or_max ON app_growflowcommand.content_approval_history
  FOR ALL
  USING  (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()))
  WITH CHECK (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()));

CREATE TABLE app_growflowcommand.user_scheduling_preferences (
  id                     uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  default_schedule_times jsonb   DEFAULT '[]'::jsonb,
  timezone               text    DEFAULT 'America/New_York',
  auto_schedule_enabled  boolean DEFAULT false,
  schedule_gap_hours     integer DEFAULT 2,
  preferred_days         text[]  DEFAULT ARRAY['monday','tuesday','wednesday','thursday','friday'],
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_growflowcommand.user_scheduling_preferences ENABLE ROW LEVEL SECURITY;

GRANT ALL                            ON app_growflowcommand.user_scheduling_preferences TO app_growflowcommand_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_growflowcommand.user_scheduling_preferences TO authenticated;

CREATE POLICY user_scheduling_preferences_own_or_max ON app_growflowcommand.user_scheduling_preferences
  FOR ALL
  USING  (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()))
  WITH CHECK (auth.uid() = user_id AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member()));

CREATE INDEX idx_profiles_app_origin             ON app_growflowcommand.profiles(app_origin);

CREATE INDEX idx_content_pillars_user            ON app_growflowcommand.content_pillars(user_id);

CREATE INDEX idx_generated_content_user          ON app_growflowcommand.generated_content(user_id);

CREATE INDEX idx_generated_content_status        ON app_growflowcommand.generated_content(status);

CREATE INDEX idx_generated_content_scheduled     ON app_growflowcommand.generated_content(scheduled_for) WHERE scheduled_for IS NOT NULL;

CREATE INDEX idx_content_approval_content        ON app_growflowcommand.content_approval_history(content_id);

CREATE INDEX idx_user_scheduling_prefs_user      ON app_growflowcommand.user_scheduling_preferences(user_id);

INSERT INTO storage.buckets (name, public)
VALUES ('app_growflowcommand_content-images', true)
ON CONFLICT (name) DO NOTHING;

CREATE POLICY app_growflowcommand_storage_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket = 'app_growflowcommand_content-images'
    AND (app_growflowcommand.is_member(auth.uid()) OR public.is_max_member())
  );

CREATE POLICY app_growflowcommand_storage_read ON storage.objects
  FOR SELECT TO public
  USING (bucket = 'app_growflowcommand_content-images');
