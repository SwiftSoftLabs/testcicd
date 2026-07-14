CREATE SCHEMA IF NOT EXISTS app_agentzero;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_agentzero_user') THEN
    CREATE ROLE app_agentzero_user NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_agentzero_user;

GRANT USAGE ON SCHEMA app_agentzero TO app_agentzero_user;

GRANT CREATE ON SCHEMA app_agentzero TO app_agentzero_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_agentzero
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_agentzero_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_agentzero
  GRANT USAGE, SELECT ON SEQUENCES TO app_agentzero_user;

GRANT USAGE ON SCHEMA app_agentzero TO anon, authenticated;

CREATE TABLE IF NOT EXISTS app_agentzero.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT,
  avatar_url      TEXT,
  trust_score     INTEGER DEFAULT 0,
  id_verified     BOOLEAN DEFAULT FALSE,
  app_origin      TEXT DEFAULT 'app_agentzero',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_agentzero.listings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address               TEXT NOT NULL,
  price                 NUMERIC(12,2),
  status                TEXT DEFAULT 'draft',
  vision_analysis_json  JSONB,
  ai_description        TEXT,
  listing_phase         TEXT DEFAULT 'setup',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_agentzero.tours (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    UUID NOT NULL REFERENCES app_agentzero.listings(id) ON DELETE CASCADE,
  seeker_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  access_code   TEXT,
  status        TEXT DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_agentzero.offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES app_agentzero.listings(id) ON DELETE CASCADE,
  buyer_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offer_price     NUMERIC(12,2) NOT NULL,
  earnest_money   NUMERIC(12,2),
  closing_date    DATE,
  contingencies   JSONB DEFAULT '[]',
  ai_score        INTEGER,
  ai_reasoning    TEXT,
  status          TEXT DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_agentzero.profiles  ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_agentzero.listings  ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_agentzero.tours     ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_agentzero.offers    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_own" ON app_agentzero.profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "listings_host_manage" ON app_agentzero.listings
  FOR ALL USING (auth.uid() = host_id);

CREATE POLICY "listings_public_view" ON app_agentzero.listings
  FOR SELECT USING (status = 'active');

CREATE POLICY "tours_participant" ON app_agentzero.tours
  FOR ALL USING (
    auth.uid() = seeker_id
    OR auth.uid() = (SELECT host_id FROM app_agentzero.listings WHERE id = listing_id)
  );

CREATE POLICY "offers_participant" ON app_agentzero.offers
  FOR ALL USING (
    auth.uid() = buyer_id
    OR auth.uid() = (SELECT host_id FROM app_agentzero.listings WHERE id = listing_id)
  );

CREATE OR REPLACE FUNCTION app_agentzero.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'app_origin' = 'app_agentzero' THEN
    INSERT INTO app_agentzero.profiles (id, full_name, avatar_url)
    VALUES (
      NEW.id,
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_agentzero ON auth.users;

CREATE TRIGGER on_auth_user_created_agentzero
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_agentzero.handle_new_user();
