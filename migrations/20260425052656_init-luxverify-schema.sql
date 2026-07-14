CREATE SCHEMA IF NOT EXISTS app_Authentic;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_Authentic_user') THEN
    CREATE ROLE app_Authentic_user NOLOGIN NOINHERIT;
  END IF;
END$$;

REVOKE ALL ON SCHEMA public FROM app_Authentic_user;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_Authentic_user;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_Authentic_user;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM app_Authentic_user;

GRANT USAGE ON SCHEMA app_Authentic TO app_Authentic_user;

GRANT ALL ON ALL TABLES IN SCHEMA app_Authentic TO app_Authentic_user;

GRANT ALL ON ALL SEQUENCES IN SCHEMA app_Authentic TO app_Authentic_user;

GRANT ALL ON ALL FUNCTIONS IN SCHEMA app_Authentic TO app_Authentic_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_Authentic
  GRANT ALL ON TABLES TO app_Authentic_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_Authentic
  GRANT ALL ON SEQUENCES TO app_Authentic_user;

ALTER ROLE app_Authentic_user SET search_path TO app_Authentic;

CREATE TABLE app_Authentic.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text,
  role        text NOT NULL DEFAULT 'Reseller'
                CHECK (role IN ('Platinum Member', 'Reseller', 'Institution')),
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_Authentic.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: owner select"
  ON app_Authentic.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles: owner update"
  ON app_Authentic.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION app_Authentic.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app_Authentic AS $$
BEGIN
  INSERT INTO app_Authentic.profiles (id, name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_Authentic.handle_new_user();

CREATE TABLE app_Authentic.assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  brand             text NOT NULL,
  model             text,
  serial            text,
  image_url         text,
  image_key         text,
  category          text NOT NULL CHECK (category IN ('Watch', 'Bag', 'Shoe', 'Jewelry')),
  status            text NOT NULL DEFAULT 'Pending'
                      CHECK (status IN ('Authentic', 'Counterfeit', 'Pending')),
  verification_date timestamptz,
  value             numeric,
  scan_id           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_Authentic.assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assets: owner select"
  ON app_Authentic.assets FOR SELECT
  TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "assets: owner insert"
  ON app_Authentic.assets FOR INSERT
  TO authenticated WITH CHECK (owner_id = auth.uid());

CREATE POLICY "assets: owner update"
  ON app_Authentic.assets FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "assets: owner delete"
  ON app_Authentic.assets FOR DELETE
  TO authenticated USING (owner_id = auth.uid());

CREATE TABLE app_Authentic.forensic_points (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    uuid NOT NULL REFERENCES app_Authentic.assets(id) ON DELETE CASCADE,
  label       text NOT NULL,
  description text,
  status      text NOT NULL CHECK (status IN ('Match', 'Anomaly', 'Minor Var.'))
);

ALTER TABLE app_Authentic.forensic_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "forensic_points: owner select"
  ON app_Authentic.forensic_points FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_Authentic.assets a
      WHERE a.id = asset_id AND a.owner_id = auth.uid()
    )
  );

CREATE POLICY "forensic_points: owner insert"
  ON app_Authentic.forensic_points FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_Authentic.assets a
      WHERE a.id = asset_id AND a.owner_id = auth.uid()
    )
  );

CREATE TABLE app_Authentic.timeline_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    uuid NOT NULL REFERENCES app_Authentic.assets(id) ON DELETE CASCADE,
  event_date  timestamptz NOT NULL DEFAULT now(),
  title       text NOT NULL,
  description text,
  icon        text,
  color       text
);

ALTER TABLE app_Authentic.timeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "timeline_events: owner select"
  ON app_Authentic.timeline_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_Authentic.assets a
      WHERE a.id = asset_id AND a.owner_id = auth.uid()
    )
  );

CREATE POLICY "timeline_events: owner insert"
  ON app_Authentic.timeline_events FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_Authentic.assets a
      WHERE a.id = asset_id AND a.owner_id = auth.uid()
    )
  );

CREATE TABLE app_Authentic.api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_prefix   text NOT NULL,
  key_hash     text NOT NULL,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_Authentic.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_keys: owner all"
  ON app_Authentic.api_keys FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE TABLE app_Authentic.webhooks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url        text NOT NULL,
  event      text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_Authentic.webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhooks: owner all"
  ON app_Authentic.webhooks FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
