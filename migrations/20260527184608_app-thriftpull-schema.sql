CREATE SCHEMA IF NOT EXISTS app_thriftpull;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_thriftpull_user') THEN
    CREATE ROLE app_thriftpull_user;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_thriftpull_user;

GRANT USAGE ON SCHEMA app_thriftpull TO app_thriftpull_user;

GRANT CREATE  ON SCHEMA app_thriftpull TO app_thriftpull_user;

ALTER ROLE app_thriftpull_user SET search_path TO app_thriftpull;

SET search_path TO app_thriftpull;

CREATE TABLE IF NOT EXISTS app_thriftpull.profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT,
  image       TEXT,
  plan        TEXT NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO', 'UNLIMITED')),
  app_origin  TEXT NOT NULL DEFAULT 'app_thriftpull',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_thriftpull.searches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url       TEXT NOT NULL,
  image_key       TEXT,
  marketplaces    TEXT[] NOT NULL DEFAULT '{}',
  results         JSONB NOT NULL DEFAULT '[]',
  result_count    INTEGER NOT NULL DEFAULT 0,
  search_ms       INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_thriftpull.saved_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  search_id       UUID REFERENCES app_thriftpull.searches(id) ON DELETE SET NULL,
  marketplace     TEXT NOT NULL,
  title           TEXT NOT NULL,
  price           NUMERIC(10,2),
  currency        TEXT NOT NULL DEFAULT 'USD',
  url             TEXT NOT NULL,
  thumbnail       TEXT,
  match_score     NUMERIC(5,4),
  retail_price    NUMERIC(10,2),
  alert_price     NUMERIC(10,2),
  alert_fired     BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_thriftpull.subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id  TEXT,
  stripe_sub_id       TEXT,
  plan                TEXT NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO', 'UNLIMITED')),
  status              TEXT NOT NULL DEFAULT 'active',
  period_end          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thriftpull_searches_user_id   ON app_thriftpull.searches(user_id);

CREATE INDEX IF NOT EXISTS idx_thriftpull_saved_user_id      ON app_thriftpull.saved_items(user_id);

CREATE INDEX IF NOT EXISTS idx_thriftpull_saved_search_id    ON app_thriftpull.saved_items(search_id);

CREATE INDEX IF NOT EXISTS idx_thriftpull_subscriptions_uid  ON app_thriftpull.subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_thriftpull_subscriptions_cid  ON app_thriftpull.subscriptions(stripe_customer_id);

CREATE OR REPLACE FUNCTION app_thriftpull.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON app_thriftpull.profiles
  FOR EACH ROW EXECUTE FUNCTION app_thriftpull.set_updated_at();

CREATE OR REPLACE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON app_thriftpull.subscriptions
  FOR EACH ROW EXECUTE FUNCTION app_thriftpull.set_updated_at();

GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA app_thriftpull TO app_thriftpull_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_thriftpull TO app_thriftpull_user;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_thriftpull TO app_thriftpull_user;

ALTER TABLE app_thriftpull.profiles      ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_thriftpull.searches      ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_thriftpull.saved_items   ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_thriftpull.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: own read"
  ON app_thriftpull.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY "profiles: own insert"
  ON app_thriftpull.profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "profiles: own update"
  ON app_thriftpull.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "searches: own read"
  ON app_thriftpull.searches FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY "searches: own insert"
  ON app_thriftpull.searches FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "searches: own delete"
  ON app_thriftpull.searches FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "saved: own read"
  ON app_thriftpull.saved_items FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY "saved: own insert"
  ON app_thriftpull.saved_items FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "saved: own update"
  ON app_thriftpull.saved_items FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "saved: own delete"
  ON app_thriftpull.saved_items FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "subscriptions: own read"
  ON app_thriftpull.subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()));

CREATE POLICY "subscriptions: service insert"
  ON app_thriftpull.subscriptions FOR INSERT TO postgres
  WITH CHECK (true);

CREATE POLICY "subscriptions: service update"
  ON app_thriftpull.subscriptions FOR UPDATE TO postgres
  USING (true);

CREATE OR REPLACE VIEW public.thriftpull_profiles
  WITH (security_invoker = true)
AS SELECT * FROM app_thriftpull.profiles;

CREATE OR REPLACE VIEW public.thriftpull_searches
  WITH (security_invoker = true)
AS SELECT * FROM app_thriftpull.searches;

CREATE OR REPLACE VIEW public.thriftpull_saved_items
  WITH (security_invoker = true)
AS SELECT * FROM app_thriftpull.saved_items;

CREATE OR REPLACE VIEW public.thriftpull_subscriptions
  WITH (security_invoker = true)
AS SELECT * FROM app_thriftpull.subscriptions;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.thriftpull_profiles,
  public.thriftpull_searches,
  public.thriftpull_saved_items
TO authenticated;

GRANT SELECT ON public.thriftpull_subscriptions TO authenticated;

CREATE OR REPLACE FUNCTION app_thriftpull.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_thriftpull AS $$
BEGIN
  IF (NEW.raw_user_meta_data->>'app_origin') = 'app_thriftpull' THEN
    INSERT INTO app_thriftpull.profiles (user_id, name, image, app_origin)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
      NEW.raw_user_meta_data->>'avatar_url',
      'app_thriftpull'
    )
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO app_thriftpull.subscriptions (user_id, plan, status)
    VALUES (NEW.id, 'FREE', 'active')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_thriftpull_new_user
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_thriftpull.handle_new_user();
