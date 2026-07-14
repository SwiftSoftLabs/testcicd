CREATE SCHEMA IF NOT EXISTS app_circa;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_circa_user') THEN
    CREATE ROLE app_circa_user NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_circa_user;

GRANT USAGE ON SCHEMA app_circa TO app_circa_user;

GRANT CREATE ON SCHEMA app_circa TO app_circa_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_circa
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_circa_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_circa
  GRANT USAGE, SELECT ON SEQUENCES TO app_circa_user;

GRANT USAGE ON SCHEMA app_circa TO anon, authenticated;

CREATE TABLE IF NOT EXISTS app_circa.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT,
  avatar_url    TEXT,
  app_origin    TEXT DEFAULT 'circa',
  tier          TEXT DEFAULT 'standard' CHECK (tier IN ('standard', 'max')),
  id_verified   BOOLEAN DEFAULT FALSE,
  stripe_id     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_circa.listings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT,
  brand         TEXT,
  condition     TEXT CHECK (condition IN ('Excellent', 'Very Good', 'Good', 'Fair')),
  price_cents   BIGINT NOT NULL DEFAULT 0,
  mode          TEXT NOT NULL CHECK (mode IN ('rent', 'sell', 'fractional')),
  images        TEXT[] DEFAULT '{}',
  certified     BOOLEAN DEFAULT FALSE,
  status        TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  ai_tags       JSONB DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_circa.transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    UUID NOT NULL REFERENCES app_circa.listings(id) ON DELETE CASCADE,
  renter_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('rent', 'sell', 'fractional')),
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  amount_cents  BIGINT DEFAULT 0,
  stripe_pi_id  TEXT,
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_circa.profiles     ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_circa.listings     ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_circa.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_own" ON app_circa.profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "listings_owner_manage" ON app_circa.listings
  FOR ALL USING (auth.uid() = owner_id);

CREATE POLICY "listings_public_view" ON app_circa.listings
  FOR SELECT USING (status = 'active');

CREATE POLICY "transactions_participant" ON app_circa.transactions
  FOR ALL USING (
    auth.uid() = renter_id
    OR auth.uid() = (SELECT owner_id FROM app_circa.listings WHERE id = listing_id)
  );

CREATE OR REPLACE FUNCTION app_circa.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'app_origin' = 'circa' THEN
    INSERT INTO app_circa.profiles (id, full_name, avatar_url)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'),
      NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_circa ON auth.users;

CREATE TRIGGER on_auth_user_created_circa
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_circa.handle_new_user();
