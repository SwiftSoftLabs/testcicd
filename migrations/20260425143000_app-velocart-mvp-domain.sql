CREATE TABLE IF NOT EXISTS app_velocart.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  sku text NOT NULL,
  category text,
  price numeric(10, 2) NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  image_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, sku)
);

CREATE TABLE IF NOT EXISTS app_velocart.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime_type text,
  status text NOT NULL DEFAULT 'processing',
  chunks integer NOT NULL DEFAULT 0,
  storage_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_velocart.stream_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'tiktok',
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS app_velocart.chat_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stream_session_id uuid REFERENCES app_velocart.stream_sessions(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  question text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_velocart.suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_event_id uuid REFERENCES app_velocart.chat_events(id) ON DELETE CASCADE,
  response text NOT NULL,
  source text NOT NULL DEFAULT 'ai',
  state text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS app_velocart.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_velocart.app_settings (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tone integer NOT NULL DEFAULT 50,
  detail_level integer NOT NULL DEFAULT 50,
  system_instructions text NOT NULL DEFAULT '',
  forbidden_phrases text[] NOT NULL DEFAULT '{}'::text[],
  pii_redaction jsonb NOT NULL DEFAULT '{"email": true, "ssn": true, "credit_card": true}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_velocart.platform_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected',
  external_account text,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, provider)
);

CREATE TABLE IF NOT EXISTS app_velocart.analytics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  recovered_revenue numeric(12, 2) NOT NULL DEFAULT 0,
  conversion_rate numeric(6, 2) NOT NULL DEFAULT 0,
  questions_answered integer NOT NULL DEFAULT 0,
  sentiment integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_inventory_owner ON app_velocart.inventory_items(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_docs_owner ON app_velocart.knowledge_documents(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_events_owner_created ON app_velocart.chat_events(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_owner_created ON app_velocart.notifications(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_owner_day ON app_velocart.analytics_daily(owner_user_id, day DESC);

CREATE OR REPLACE FUNCTION app_velocart.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_touch_updated_at ON app_velocart.inventory_items;

CREATE TRIGGER trg_inventory_touch_updated_at
BEFORE UPDATE ON app_velocart.inventory_items
FOR EACH ROW EXECUTE FUNCTION app_velocart.touch_updated_at();

DROP TRIGGER IF EXISTS trg_docs_touch_updated_at ON app_velocart.knowledge_documents;

CREATE TRIGGER trg_docs_touch_updated_at
BEFORE UPDATE ON app_velocart.knowledge_documents
FOR EACH ROW EXECUTE FUNCTION app_velocart.touch_updated_at();

DROP TRIGGER IF EXISTS trg_settings_touch_updated_at ON app_velocart.app_settings;

CREATE TRIGGER trg_settings_touch_updated_at
BEFORE UPDATE ON app_velocart.app_settings
FOR EACH ROW EXECUTE FUNCTION app_velocart.touch_updated_at();

DROP TRIGGER IF EXISTS trg_integrations_touch_updated_at ON app_velocart.platform_integrations;

CREATE TRIGGER trg_integrations_touch_updated_at
BEFORE UPDATE ON app_velocart.platform_integrations
FOR EACH ROW EXECUTE FUNCTION app_velocart.touch_updated_at();
