DROP VIEW IF EXISTS public.users CASCADE;

DROP VIEW IF EXISTS public.transactions CASCADE;

DROP VIEW IF EXISTS public.chats CASCADE;

DROP VIEW IF EXISTS public.messages CASCADE;

DROP VIEW IF EXISTS public.settings CASCADE;

DROP VIEW IF EXISTS public.ad_events CASCADE;

CREATE OR REPLACE VIEW public.users AS SELECT * FROM app_liteai.users;

CREATE OR REPLACE VIEW public.transactions AS SELECT * FROM app_liteai.transactions;

CREATE OR REPLACE VIEW public.chats AS SELECT * FROM app_liteai.chats;

CREATE OR REPLACE VIEW public.messages AS SELECT * FROM app_liteai.messages;

CREATE OR REPLACE VIEW public.settings AS SELECT * FROM app_liteai.settings;

CREATE OR REPLACE VIEW public.ad_events AS SELECT * FROM app_liteai.ad_events;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats TO PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO PUBLIC;

GRANT SELECT ON public.settings TO PUBLIC;

GRANT SELECT ON public.ad_events TO PUBLIC;

CREATE OR REPLACE FUNCTION public.wallet_apply_delta(
    p_user_id UUID,
    p_amount INTEGER,
    p_type TEXT,
    p_source TEXT,
    p_ad_event_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = app_liteai
AS $$
  SELECT app_liteai.wallet_apply_delta(p_user_id, p_amount, p_type, p_source, p_ad_event_id);
$$;

CREATE OR REPLACE FUNCTION public.ensure_user(p_user_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = app_liteai
AS $$
  SELECT app_liteai.ensure_user(p_user_id);
$$;

GRANT EXECUTE ON FUNCTION public.wallet_apply_delta(UUID, INTEGER, TEXT, TEXT, TEXT) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_user(UUID) TO PUBLIC;
