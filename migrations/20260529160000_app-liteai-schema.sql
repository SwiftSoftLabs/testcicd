CREATE SCHEMA IF NOT EXISTS app_liteai;

CREATE TABLE IF NOT EXISTS app_liteai.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    balance INTEGER DEFAULT 0 NOT NULL,
    tier TEXT DEFAULT 'lite',
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE app_liteai.users ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS app_liteai.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES app_liteai.users(id) NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    ad_event_id TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE app_liteai.transactions ADD COLUMN IF NOT EXISTS ad_event_id TEXT;

CREATE TABLE IF NOT EXISTS app_liteai.chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES app_liteai.users(id) NOT NULL,
    title TEXT,
    last_message TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_liteai.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID REFERENCES app_liteai.chats(id) ON DELETE CASCADE NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    cost INTEGER DEFAULT 0,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_liteai.settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_liteai.ad_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES app_liteai.users(id) NOT NULL,
    ad_event_id TEXT NOT NULL UNIQUE,
    amount INTEGER NOT NULL DEFAULT 50,
    verified_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO app_liteai.settings (key, value) VALUES
    ('credit_cost_lite', '0'),
    ('credit_cost_heavy', '10'),
    ('credit_reward_ad', '50')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION app_liteai.wallet_apply_delta(
    p_user_id UUID,
    p_amount INTEGER,
    p_type TEXT,
    p_source TEXT,
    p_ad_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_liteai
AS $$
DECLARE
    v_balance INTEGER;
    v_tx_id UUID;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_USER');
    END IF;

    SELECT balance INTO v_balance
    FROM app_liteai.users
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
    END IF;

    IF v_balance + p_amount < 0 THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'INSUFFICIENT_CREDITS',
            'balance', v_balance
        );
    END IF;

    UPDATE app_liteai.users
    SET balance = balance + p_amount
    WHERE id = p_user_id
    RETURNING balance INTO v_balance;

    INSERT INTO app_liteai.transactions (user_id, amount, type, source, ad_event_id)
    VALUES (p_user_id, p_amount, p_type, p_source, p_ad_event_id)
    RETURNING id INTO v_tx_id;

    RETURN jsonb_build_object(
        'ok', true,
        'balance', v_balance,
        'transaction_id', v_tx_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION app_liteai.ensure_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_liteai
AS $$
BEGIN
    INSERT INTO app_liteai.users (id, balance, tier)
    VALUES (p_user_id, 10, 'lite')
    ON CONFLICT (id) DO NOTHING;
END;
$$;

ALTER TABLE app_liteai.users ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_liteai.transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_liteai.chats ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_liteai.messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_liteai.settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_liteai.ad_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own data" ON app_liteai.users;

DROP POLICY IF EXISTS "Users can update own preferences" ON app_liteai.users;

DROP POLICY IF EXISTS "Users can view their own transactions" ON app_liteai.transactions;

DROP POLICY IF EXISTS "Users can view their own chats" ON app_liteai.chats;

DROP POLICY IF EXISTS "Users can insert own chats" ON app_liteai.chats;

DROP POLICY IF EXISTS "Users can update own chats" ON app_liteai.chats;

DROP POLICY IF EXISTS "Users can delete own chats" ON app_liteai.chats;

DROP POLICY IF EXISTS "Users can view messages in their chats" ON app_liteai.messages;

DROP POLICY IF EXISTS "Users can view own ad events" ON app_liteai.ad_events;

DROP POLICY IF EXISTS "Settings read for authenticated" ON app_liteai.settings;

CREATE POLICY "Users can view their own data" ON app_liteai.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own preferences" ON app_liteai.users
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can view their own transactions" ON app_liteai.transactions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own chats" ON app_liteai.chats
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chats" ON app_liteai.chats
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chats" ON app_liteai.chats
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own chats" ON app_liteai.chats
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view messages in their chats" ON app_liteai.messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_liteai.chats
            WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can view own ad events" ON app_liteai.ad_events
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Settings read for authenticated" ON app_liteai.settings
    FOR SELECT TO authenticated USING (true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_liteai_user') THEN
    CREATE ROLE app_liteai_user NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_liteai_user;

GRANT USAGE ON SCHEMA app_liteai TO app_liteai_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_liteai TO app_liteai_user;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app_liteai TO app_liteai_user;

ALTER ROLE app_liteai_user SET search_path TO app_liteai;
