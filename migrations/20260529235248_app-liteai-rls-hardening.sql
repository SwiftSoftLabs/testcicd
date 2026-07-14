CREATE SCHEMA IF NOT EXISTS app_liteai;

CREATE TABLE IF NOT EXISTS app_liteai.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    balance INTEGER DEFAULT 0 NOT NULL,
    tier TEXT DEFAULT 'lite' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS app_liteai.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app_liteai.users(id),
    amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS app_liteai.chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app_liteai.users(id),
    title TEXT,
    last_message TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS app_liteai.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES app_liteai.chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    cost INTEGER,
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON app_liteai.transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_chats_user_id ON app_liteai.chats(user_id);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON app_liteai.messages(chat_id);

ALTER TABLE app_liteai.users ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_liteai.transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_liteai.chats ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_liteai.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own data" ON app_liteai.users;

CREATE POLICY "Users can view their own data" ON app_liteai.users
    FOR SELECT TO authenticated
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own preferences" ON app_liteai.users;

DROP POLICY IF EXISTS "Users can view their own transactions" ON app_liteai.transactions;

CREATE POLICY "Users can view their own transactions" ON app_liteai.transactions
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own transactions" ON app_liteai.transactions;

CREATE POLICY "Users can insert their own transactions" ON app_liteai.transactions
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own chats" ON app_liteai.chats;

CREATE POLICY "Users can view their own chats" ON app_liteai.chats
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own chats" ON app_liteai.chats;

CREATE POLICY "Users can insert own chats" ON app_liteai.chats
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own chats" ON app_liteai.chats;

CREATE POLICY "Users can update own chats" ON app_liteai.chats
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own chats" ON app_liteai.chats;

CREATE POLICY "Users can delete own chats" ON app_liteai.chats
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view messages in their chats" ON app_liteai.messages;

CREATE POLICY "Users can view messages in their chats" ON app_liteai.messages
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM app_liteai.chats
            WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can insert messages in their chats" ON app_liteai.messages;

CREATE POLICY "Users can insert messages in their chats" ON app_liteai.messages
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM app_liteai.chats
            WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update messages in their chats" ON app_liteai.messages;

CREATE POLICY "Users can update messages in their chats" ON app_liteai.messages
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM app_liteai.chats
            WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM app_liteai.chats
            WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can delete messages in their chats" ON app_liteai.messages;

CREATE POLICY "Users can delete messages in their chats" ON app_liteai.messages
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM app_liteai.chats
            WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid()
        )
    );

GRANT USAGE ON SCHEMA app_liteai TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_liteai TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_liteai
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

GRANT USAGE ON SCHEMA app_liteai TO anon;

CREATE OR REPLACE FUNCTION app_liteai.set_app_origin()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(NEW.profile->>'app_origin', NEW.metadata->>'app_origin', '') = 'app_liteai' THEN
    NEW.profile := COALESCE(NEW.profile, '{}'::jsonb) || '{"app_origin": "app_liteai"}'::jsonb;
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || '{"app_origin": "app_liteai"}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_liteai_set_app_origin ON auth.users;

CREATE TRIGGER trg_app_liteai_set_app_origin
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_liteai.set_app_origin();

CREATE OR REPLACE FUNCTION app_liteai.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  _origin TEXT;
BEGIN
  _origin := COALESCE(NEW.profile->>'app_origin', NEW.metadata->>'app_origin', '');
  IF _origin <> 'app_liteai' THEN
    RETURN NEW;
  END IF;

  UPDATE auth.users
  SET
    profile = COALESCE(profile, '{}'::jsonb) || '{"app_origin": "app_liteai"}'::jsonb,
    metadata = COALESCE(metadata, '{}'::jsonb) || '{"app_origin": "app_liteai"}'::jsonb
  WHERE id = NEW.id;

  INSERT INTO app_liteai.users (id, balance, tier)
  VALUES (NEW.id, 10, 'lite')
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO app_liteai, auth;

DROP TRIGGER IF EXISTS on_auth_user_created_liteai ON auth.users;

CREATE TRIGGER on_auth_user_created_liteai
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_liteai.handle_new_user();

CREATE OR REPLACE FUNCTION app_liteai.ensure_user()
RETURNS app_liteai.users AS $$
DECLARE
  _uid UUID := auth.uid();
  _row app_liteai.users;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE auth.users
  SET
    profile = COALESCE(profile, '{}'::jsonb) || '{"app_origin": "app_liteai"}'::jsonb,
    metadata = COALESCE(metadata, '{}'::jsonb) || '{"app_origin": "app_liteai"}'::jsonb
  WHERE id = _uid;

  INSERT INTO app_liteai.users (id, balance, tier)
  VALUES (_uid, 10, 'lite')
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO _row FROM app_liteai.users WHERE id = _uid;
  RETURN _row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO app_liteai, auth;

REVOKE ALL ON FUNCTION app_liteai.ensure_user() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_liteai.ensure_user() TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_liteai_user') THEN
    CREATE ROLE app_liteai_user NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_liteai_user;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_liteai_user;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_liteai_user;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM app_liteai_user;

GRANT USAGE, CREATE ON SCHEMA app_liteai TO app_liteai_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_liteai TO app_liteai_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_liteai TO app_liteai_user;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_liteai TO app_liteai_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_liteai
  GRANT ALL ON TABLES TO app_liteai_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_liteai
  GRANT ALL ON SEQUENCES TO app_liteai_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_liteai
  GRANT EXECUTE ON FUNCTIONS TO app_liteai_user;

ALTER ROLE app_liteai_user SET search_path TO app_liteai;
