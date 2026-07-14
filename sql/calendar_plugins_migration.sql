-- Calendar plugin installations (bidirectional sync) and event links.
-- Separate from calendar_video_integrations (Meet/Zoom conferencing).

CREATE TABLE IF NOT EXISTS app_onework.calendar_plugin_installations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('google_calendar', 'outlook', 'calendly')),
  account_email       TEXT,
  account_name        TEXT,
  account_id          TEXT NOT NULL,
  scopes              TEXT[] NOT NULL DEFAULT '{}',
  encrypted_token     TEXT NOT NULL,
  encrypted_refresh   TEXT,
  token_expires_at    TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'revoked')),
  settings            JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_cursor         JSONB NOT NULL DEFAULT '{}'::jsonb,
  webhook_channel_id  TEXT,
  webhook_expires_at  TIMESTAMPTZ,
  last_synced_at      TIMESTAMPTZ,
  last_sync_error     TEXT,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS app_onework.plugin_event_links (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              UUID NOT NULL REFERENCES app_onework.events(id) ON DELETE CASCADE,
  installation_id       UUID NOT NULL REFERENCES app_onework.calendar_plugin_installations(id) ON DELETE CASCADE,
  external_event_id     TEXT NOT NULL,
  external_calendar_id  TEXT,
  external_updated_at   TIMESTAMPTZ,
  external_etag         TEXT,
  last_pushed_at        TIMESTAMPTZ,
  last_pulled_at        TIMESTAMPTZ,
  sync_origin           TEXT NOT NULL DEFAULT 'import' CHECK (sync_origin IN ('import', 'export', 'local')),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (installation_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS calendar_plugin_installations_user_provider_idx
  ON app_onework.calendar_plugin_installations(user_id, provider);

CREATE INDEX IF NOT EXISTS plugin_event_links_event_idx
  ON app_onework.plugin_event_links(event_id);

CREATE INDEX IF NOT EXISTS plugin_event_links_installation_idx
  ON app_onework.plugin_event_links(installation_id);

-- Extend events.source for plugin-sourced events
ALTER TABLE app_onework.events
  DROP CONSTRAINT IF EXISTS events_source_check;

ALTER TABLE app_onework.events
  ADD CONSTRAINT events_source_check CHECK (source IN ('manual', 'email', 'plugin'));

ALTER TABLE app_onework.events
  ADD COLUMN IF NOT EXISTS source_plugin_installation_id UUID REFERENCES app_onework.calendar_plugin_installations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_plugin_provider TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_plugin_source_account_check'
      AND conrelid = 'app_onework.events'::regclass
  ) THEN
    ALTER TABLE app_onework.events
      ADD CONSTRAINT events_plugin_source_account_check
      CHECK (source <> 'plugin' OR account_id IS NOT NULL);
  END IF;
END $$;

GRANT ALL PRIVILEGES ON app_onework.calendar_plugin_installations TO app_onework_user;
GRANT ALL PRIVILEGES ON app_onework.plugin_event_links TO app_onework_user;

ALTER TABLE app_onework.calendar_plugin_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.plugin_event_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calendar_plugin_installations_owner_access" ON app_onework.calendar_plugin_installations;
CREATE POLICY "calendar_plugin_installations_owner_access" ON app_onework.calendar_plugin_installations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "calendar_plugin_installations_max_read" ON app_onework.calendar_plugin_installations;
CREATE POLICY "calendar_plugin_installations_max_read" ON app_onework.calendar_plugin_installations
  FOR SELECT USING (public.is_max_member(auth.uid()));

DROP POLICY IF EXISTS "plugin_event_links_owner_access" ON app_onework.plugin_event_links;
CREATE POLICY "plugin_event_links_owner_access" ON app_onework.plugin_event_links
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM app_onework.calendar_plugin_installations i
      WHERE i.id = plugin_event_links.installation_id
        AND i.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_onework.calendar_plugin_installations i
      WHERE i.id = plugin_event_links.installation_id
        AND i.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "plugin_event_links_max_read" ON app_onework.plugin_event_links;
CREATE POLICY "plugin_event_links_max_read" ON app_onework.plugin_event_links
  FOR SELECT USING (public.is_max_member(auth.uid()));
