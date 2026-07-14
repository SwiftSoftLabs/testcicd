-- Calendar video conferencing integrations and event metadata.
-- Run against the existing SwiftSoftLabs InsForge project. Do not create a new project/database.

CREATE TABLE IF NOT EXISTS app_onework.calendar_video_integrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('google_calendar','zoom')),
  account_email       TEXT,
  account_name        TEXT,
  account_id          TEXT NOT NULL,
  scopes              TEXT[] NOT NULL DEFAULT '{}',
  encrypted_token     TEXT NOT NULL,
  encrypted_refresh   TEXT,
  token_expires_at    TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','error','revoked')),
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS app_onework.event_conferences (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES app_onework.events(id) ON DELETE CASCADE,
  integration_id      UUID REFERENCES app_onework.calendar_video_integrations(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL CHECK (provider IN ('google_meet','zoom')),
  join_url            TEXT NOT NULL,
  external_event_id   TEXT,
  external_meeting_id TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','error')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS calendar_video_integrations_user_provider_idx
  ON app_onework.calendar_video_integrations(user_id, provider);

CREATE INDEX IF NOT EXISTS event_conferences_event_idx
  ON app_onework.event_conferences(event_id);

GRANT ALL PRIVILEGES ON app_onework.calendar_video_integrations TO app_onework_user;
GRANT ALL PRIVILEGES ON app_onework.event_conferences TO app_onework_user;

ALTER TABLE app_onework.calendar_video_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.event_conferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calendar_video_integrations_owner_access" ON app_onework.calendar_video_integrations;
CREATE POLICY "calendar_video_integrations_owner_access" ON app_onework.calendar_video_integrations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "calendar_video_integrations_max_read" ON app_onework.calendar_video_integrations;
CREATE POLICY "calendar_video_integrations_max_read" ON app_onework.calendar_video_integrations
  FOR SELECT USING (public.is_max_member(auth.uid()));

DROP POLICY IF EXISTS "event_conferences_event_access" ON app_onework.event_conferences;
CREATE POLICY "event_conferences_event_access" ON app_onework.event_conferences
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.events e
      LEFT JOIN app_onework.workspaces w ON w.id = e.workspace_id
      LEFT JOIN app_onework.workspace_members wm
        ON wm.workspace_id = e.workspace_id
       AND wm.user_id = auth.uid()
      WHERE e.id = event_conferences.event_id
        AND (
          e.account_id = auth.uid()
          OR w.owner_id = auth.uid()
          OR wm.user_id = auth.uid()
          OR (e.workspace_id IS NOT NULL AND public.is_max_member(auth.uid()))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM app_onework.events e
      LEFT JOIN app_onework.workspaces w ON w.id = e.workspace_id
      LEFT JOIN app_onework.workspace_members wm
        ON wm.workspace_id = e.workspace_id
       AND wm.user_id = auth.uid()
      WHERE e.id = event_conferences.event_id
        AND (
          e.account_id = auth.uid()
          OR w.owner_id = auth.uid()
          OR wm.user_id = auth.uid()
          OR (e.workspace_id IS NOT NULL AND public.is_max_member(auth.uid()))
        )
    )
  );
