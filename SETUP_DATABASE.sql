-- ============================================
-- OneWork Database Setup (SWIFT_LABS_MANIFEST)
-- ============================================
-- Run these SQL blocks in your InsForge database dashboard
-- in the exact order shown below.

-- ============================================
-- BLOCK 1: Schema & Role Creation
-- ============================================
CREATE SCHEMA IF NOT EXISTS app_onework;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_onework_user') THEN
    CREATE ROLE app_onework_user NOLOGIN;
  END IF;
END $$;


-- ============================================
-- BLOCK 2: Hard Isolation (MANIFEST §2)
-- ============================================
REVOKE ALL ON SCHEMA public FROM app_onework_user;
GRANT USAGE, CREATE ON SCHEMA app_onework TO app_onework_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_onework TO app_onework_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_onework GRANT ALL ON TABLES TO app_onework_user;
ALTER ROLE app_onework_user SET search_path TO app_onework;


-- ============================================
-- BLOCK 3: Core Tables
-- ============================================
CREATE TABLE IF NOT EXISTS app_onework.profiles (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT        NOT NULL UNIQUE,
  full_name  TEXT,
  avatar_url TEXT,
  onboarding_type          TEXT        NOT NULL DEFAULT 'creator',
  pending_join_notification TEXT                 DEFAULT NULL,
  role       TEXT        NOT NULL DEFAULT 'member',
  status     TEXT        NOT NULL DEFAULT 'online',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_onework.profiles
  ADD COLUMN IF NOT EXISTS onboarding_type TEXT NOT NULL DEFAULT 'creator';

ALTER TABLE app_onework.profiles
  ADD COLUMN IF NOT EXISTS pending_join_notification TEXT DEFAULT NULL;

ALTER TABLE app_onework.profiles
  ADD COLUMN IF NOT EXISTS git_name TEXT,
  ADD COLUMN IF NOT EXISTS git_email TEXT;

CREATE TABLE IF NOT EXISTS app_onework.workspaces (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  slug       TEXT        UNIQUE,
  owner_id   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  rbac_config JSONB      NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_onework.workspaces
  ADD COLUMN IF NOT EXISTS rbac_config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS app_onework.workspace_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS app_onework.workspace_presence (
  workspace_id UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'online',
  is_manual    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE app_onework.workspace_presence
  ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_workspace_presence_ws_updated
  ON app_onework.workspace_presence(workspace_id, updated_at DESC);

INSERT INTO app_onework.workspace_presence (workspace_id, user_id, status, updated_at)
SELECT wm.workspace_id, wm.user_id, COALESCE(p.status, 'online'), NOW()
FROM app_onework.workspace_members wm
LEFT JOIN app_onework.profiles p ON p.id = wm.user_id
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_onework.workspace_user_settings (
  workspace_id        UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  developer_mode      BOOLEAN NOT NULL DEFAULT FALSE,
  show_offline_status BOOLEAN NOT NULL DEFAULT TRUE,
  quick_taskbar_pinned BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

INSERT INTO app_onework.workspace_user_settings (workspace_id, user_id)
SELECT workspace_id, user_id
FROM app_onework.workspace_members
ON CONFLICT (workspace_id, user_id) DO NOTHING;


-- ============================================
-- BLOCK 4: Chat Tables
-- ============================================
CREATE TABLE IF NOT EXISTS app_onework.conversations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL DEFAULT 'channel' CHECK (type IN ('channel', 'dm')),
  name         TEXT,
  description  TEXT,
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_onework.conversation_members (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      UUID        NOT NULL REFERENCES app_onework.conversations(id) ON DELETE CASCADE,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role                 TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  muted                BOOLEAN     NOT NULL DEFAULT false,
  joined_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at              TIMESTAMPTZ,
  last_read_message_id UUID,
  last_read_at         TIMESTAMPTZ,
  UNIQUE(conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS app_onework.messages (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID        NOT NULL REFERENCES app_onework.conversations(id) ON DELETE CASCADE,
  sender_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content             TEXT        NOT NULL,
  type                TEXT        NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'system', 'code')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  reply_to_message_id UUID        REFERENCES app_onework.messages(id),
  thread_root_message_id UUID     REFERENCES app_onework.messages(id),
  also_sent_to_channel BOOLEAN    NOT NULL DEFAULT false,
  reply_count         INT         NOT NULL DEFAULT 0,
  last_reply_at       TIMESTAMPTZ,
  pinned              BOOLEAN     NOT NULL DEFAULT false,
  metadata            JSONB,
  client_message_id   TEXT        UNIQUE
);


-- ============================================
-- BLOCK 5: Enable RLS
-- ============================================
ALTER TABLE app_onework.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.workspaces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.workspace_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.workspace_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.messages          ENABLE ROW LEVEL SECURITY;


-- ============================================
-- BLOCK 6: RLS Policies
-- ============================================
CREATE OR REPLACE FUNCTION public.is_max_member(user_uuid UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT false;
$$;

-- profiles
CREATE POLICY "profiles_select" ON app_onework.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_max_member(auth.uid()));
CREATE POLICY "profiles_modify" ON app_onework.profiles
  FOR ALL USING (auth.uid() = id);

-- workspaces
CREATE POLICY "workspaces_read" ON app_onework.workspaces
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM app_onework.workspace_members WHERE workspace_id = workspaces.id AND user_id = auth.uid())
    OR public.is_max_member(auth.uid())
  );
CREATE POLICY "workspaces_write" ON app_onework.workspaces
  FOR ALL USING (owner_id = auth.uid());

-- workspace_members
CREATE POLICY "wm_read" ON app_onework.workspace_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM app_onework.workspace_members wm2 WHERE wm2.workspace_id = workspace_members.workspace_id AND wm2.user_id = auth.uid())
    OR public.is_max_member(auth.uid())
  );
CREATE POLICY "wm_write" ON app_onework.workspace_members
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_onework.workspaces w WHERE w.id = workspace_members.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS wp_read ON app_onework.workspace_presence;
CREATE POLICY wp_read ON app_onework.workspace_presence
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = workspace_presence.workspace_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member(auth.uid())
  );

DROP POLICY IF EXISTS wp_write ON app_onework.workspace_presence;
CREATE POLICY wp_write ON app_onework.workspace_presence
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS wus_read ON app_onework.workspace_user_settings;
CREATE POLICY wus_read ON app_onework.workspace_user_settings
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = workspace_user_settings.workspace_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member(auth.uid())
  );

DROP POLICY IF EXISTS wus_write ON app_onework.workspace_user_settings;
CREATE POLICY wus_write ON app_onework.workspace_user_settings
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT USAGE ON SCHEMA auth TO app_onework_user;
GRANT SELECT ON auth.users TO app_onework_user;
GRANT EXECUTE ON FUNCTION public.is_max_member(UUID) TO app_onework_user;


-- ============================================
-- BLOCK 7: Auto-Create Profile Trigger
-- ============================================
CREATE OR REPLACE FUNCTION app_onework.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app_onework AS $$
BEGIN
  INSERT INTO app_onework.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.metadata->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.metadata->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_onework.handle_new_user();


-- ============================================
-- BLOCK 8: External Mailbox Tables
-- ============================================
CREATE TABLE IF NOT EXISTS app_onework.mail_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_address       TEXT NOT NULL,
  provider_type       TEXT NOT NULL CHECK (provider_type IN ('gmail', 'outlook', 'custom')),
  auth_method         TEXT NOT NULL DEFAULT 'password' CHECK (auth_method IN ('password', 'oauth')),
  username            TEXT NOT NULL,
  encrypted_password  TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at    TIMESTAMPTZ,
  imap_host           TEXT NOT NULL,
  imap_port           INTEGER NOT NULL CHECK (imap_port > 0),
  imap_secure         BOOLEAN NOT NULL DEFAULT true,
  smtp_host           TEXT NOT NULL,
  smtp_port           INTEGER NOT NULL CHECK (smtp_port > 0),
  smtp_secure         BOOLEAN NOT NULL DEFAULT true,
  status              TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'disconnected')),
  last_sync_at        TIMESTAMPTZ,
  sync_cursor         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, email_address)
);

CREATE TABLE IF NOT EXISTS app_onework.mail_folders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES app_onework.mail_accounts(id) ON DELETE CASCADE,
  folder_key         TEXT NOT NULL CHECK (folder_key IN ('inbox', 'sent', 'drafts')),
  provider_folder    TEXT NOT NULL,
  last_uid_synced    BIGINT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, folder_key)
);

CREATE TABLE IF NOT EXISTS app_onework.mail_messages (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL REFERENCES app_onework.mail_accounts(id) ON DELETE CASCADE,
  workspace_id         UUID REFERENCES app_onework.workspaces(id) ON DELETE SET NULL,
  external_message_id  TEXT NOT NULL,
  provider_message_id  TEXT,
  external_uid         BIGINT,
  folder               TEXT NOT NULL CHECK (folder IN ('inbox', 'sent', 'drafts')),
  thread_id            TEXT,
  from_json            JSONB NOT NULL DEFAULT '{}'::jsonb,
  to_json              JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc_json              JSONB NOT NULL DEFAULT '[]'::jsonb,
  bcc_json             JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject              TEXT NOT NULL DEFAULT '',
  html_body            TEXT NOT NULL DEFAULT '',
  text_body            TEXT NOT NULL DEFAULT '',
  is_read              BOOLEAN NOT NULL DEFAULT false,
  is_starred           BOOLEAN NOT NULL DEFAULT false,
  is_draft             BOOLEAN NOT NULL DEFAULT false,
  snoozed_until        TIMESTAMPTZ,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, external_message_id)
);

ALTER TABLE app_onework.mail_messages
  ALTER COLUMN workspace_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS app_onework.mail_attachments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        UUID NOT NULL REFERENCES app_onework.mail_messages(id) ON DELETE CASCADE,
  external_part_id  TEXT,
  name              TEXT NOT NULL,
  mime_type         TEXT,
  size_bytes        BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_onework.mail_sync_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES app_onework.mail_accounts(id) ON DELETE CASCADE,
  status            TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  scope             TEXT NOT NULL CHECK (scope IN ('initial', 'incremental', 'manual')),
  messages_synced   INTEGER NOT NULL DEFAULT 0,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,
  error_text        TEXT
);

CREATE TABLE IF NOT EXISTS app_onework.mail_audit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  account_id  UUID REFERENCES app_onework.mail_accounts(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_accounts_user_id ON app_onework.mail_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_account_folder_received ON app_onework.mail_messages(account_id, folder, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_messages_account_provider_message_id ON app_onework.mail_messages(account_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mail_messages_account_snoozed ON app_onework.mail_messages(account_id, snoozed_until) WHERE snoozed_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mail_messages_workspace_account ON app_onework.mail_messages(workspace_id, account_id);
CREATE INDEX IF NOT EXISTS idx_mail_sync_runs_account_started ON app_onework.mail_sync_runs(account_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_audit_events_account_created ON app_onework.mail_audit_events(account_id, created_at DESC);


-- ============================================
-- BLOCK 9: External Mailbox RLS
-- ============================================
ALTER TABLE app_onework.mail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.mail_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.mail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.mail_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.mail_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.mail_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mail_accounts_owner_access" ON app_onework.mail_accounts
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "mail_folders_owner_access" ON app_onework.mail_folders
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM app_onework.mail_accounts ma
      WHERE ma.id = mail_folders.account_id
        AND ma.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_onework.mail_accounts ma
      WHERE ma.id = mail_folders.account_id
        AND ma.user_id = auth.uid()
    )
  );

CREATE POLICY "mail_messages_owner_access" ON app_onework.mail_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM app_onework.mail_accounts ma
      WHERE ma.id = mail_messages.account_id
        AND ma.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_onework.mail_accounts ma
      WHERE ma.id = mail_messages.account_id
        AND ma.user_id = auth.uid()
    )
  );

CREATE POLICY "mail_attachments_owner_access" ON app_onework.mail_attachments
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.mail_messages mm
      JOIN app_onework.mail_accounts ma ON ma.id = mm.account_id
      WHERE mm.id = mail_attachments.message_id
        AND ma.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM app_onework.mail_messages mm
      JOIN app_onework.mail_accounts ma ON ma.id = mm.account_id
      WHERE mm.id = mail_attachments.message_id
        AND ma.user_id = auth.uid()
    )
  );

CREATE POLICY "mail_sync_runs_owner_access" ON app_onework.mail_sync_runs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM app_onework.mail_accounts ma
      WHERE ma.id = mail_sync_runs.account_id
        AND ma.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_onework.mail_accounts ma
      WHERE ma.id = mail_sync_runs.account_id
        AND ma.user_id = auth.uid()
    )
  );

CREATE POLICY "mail_audit_events_owner_access" ON app_onework.mail_audit_events
  FOR SELECT USING (user_id = auth.uid());

-- MANIFEST §3: Max Tier read-through for all mail tables
CREATE POLICY "mail_accounts_max_read" ON app_onework.mail_accounts
  FOR SELECT USING (public.is_max_member(auth.uid()));

CREATE POLICY "mail_folders_max_read" ON app_onework.mail_folders
  FOR SELECT USING (public.is_max_member(auth.uid()));

CREATE POLICY "mail_messages_max_read" ON app_onework.mail_messages
  FOR SELECT USING (public.is_max_member(auth.uid()));

CREATE POLICY "mail_attachments_max_read" ON app_onework.mail_attachments
  FOR SELECT USING (public.is_max_member(auth.uid()));

CREATE POLICY "mail_sync_runs_max_read" ON app_onework.mail_sync_runs
  FOR SELECT USING (public.is_max_member(auth.uid()));

CREATE POLICY "mail_audit_events_max_read" ON app_onework.mail_audit_events
  FOR SELECT USING (public.is_max_member(auth.uid()));


-- ============================================
-- BLOCK 10: Git integrations (workspace-scoped OAuth / PAT tokens)
-- ============================================
CREATE TABLE IF NOT EXISTS app_onework.git_integrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('github','gitlab','onework')),
  auth_method         TEXT NOT NULL CHECK (auth_method IN ('oauth','pat','platform')),
  account_login       TEXT NOT NULL,
  account_id          TEXT NOT NULL,
  account_avatar_url  TEXT,
  scopes              TEXT[] NOT NULL DEFAULT '{}',
  encrypted_token     TEXT NOT NULL,
  encrypted_refresh   TEXT,
  token_expires_at    TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','error','revoked')),
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_git_integrations_ws_user ON app_onework.git_integrations(workspace_id, user_id);

ALTER TABLE app_onework.git_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "git_integrations_owner_access" ON app_onework.git_integrations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "git_integrations_max_read" ON app_onework.git_integrations
  FOR SELECT USING (public.is_max_member(auth.uid()));


-- ============================================
-- BLOCK 11: Native calendar events
-- ============================================
CREATE TABLE IF NOT EXISTS app_onework.calendars (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  color        TEXT,
  timezone     TEXT NOT NULL DEFAULT 'Asia/Manila',
  is_default   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS calendars_one_default_per_workspace_idx
  ON app_onework.calendars(workspace_id)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS calendars_workspace_idx
  ON app_onework.calendars(workspace_id);

CREATE TABLE IF NOT EXISTS app_onework.events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id  UUID REFERENCES app_onework.calendars(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  account_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'email')),
  source_mail_account_id UUID REFERENCES app_onework.mail_accounts(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES app_onework.mail_messages(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  location     TEXT,
  start_time   TIMESTAMPTZ NOT NULL,
  end_time     TIMESTAMPTZ NOT NULL,
  timezone     TEXT NOT NULL DEFAULT 'Asia/Manila',
  is_all_day   BOOLEAN NOT NULL DEFAULT false,
  status       TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (workspace_id IS NOT NULL OR account_id IS NOT NULL),
  CHECK (source <> 'email' OR account_id IS NOT NULL),
  CHECK (end_time > start_time)
);

ALTER TABLE app_onework.events
  ALTER COLUMN calendar_id DROP NOT NULL,
  ALTER COLUMN workspace_id DROP NOT NULL;

ALTER TABLE app_onework.events
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_mail_account_id UUID REFERENCES app_onework.mail_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_message_id UUID REFERENCES app_onework.mail_messages(id) ON DELETE SET NULL;

-- Recurring events: occurrences materialized one row each, linked by series_id.
ALTER TABLE app_onework.events
  ADD COLUMN IF NOT EXISTS series_id UUID,
  ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT
    CHECK (recurrence_frequency IN ('daily', 'weekdays', 'weekends', 'weekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS recurrence_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS events_series_id_idx
  ON app_onework.events (series_id) WHERE series_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_onework.event_attendees (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID        NOT NULL REFERENCES app_onework.events(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

UPDATE app_onework.events e
SET source_mail_account_id = COALESCE(e.source_mail_account_id, e.account_id),
    account_id = ma.user_id
FROM app_onework.mail_accounts ma
WHERE e.account_id = ma.id;

DO $$
BEGIN
  ALTER TABLE app_onework.events
    DROP CONSTRAINT IF EXISTS events_account_id_fkey;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_source_check'
      AND conrelid = 'app_onework.events'::regclass
  ) THEN
    ALTER TABLE app_onework.events
      ADD CONSTRAINT events_source_check CHECK (source IN ('manual', 'email'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_workspace_or_account_check'
      AND conrelid = 'app_onework.events'::regclass
  ) THEN
    ALTER TABLE app_onework.events
      ADD CONSTRAINT events_workspace_or_account_check CHECK (workspace_id IS NOT NULL OR account_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_email_source_account_check'
      AND conrelid = 'app_onework.events'::regclass
  ) THEN
    ALTER TABLE app_onework.events
      ADD CONSTRAINT events_email_source_account_check CHECK (source <> 'email' OR account_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_account_id_fkey'
      AND conrelid = 'app_onework.events'::regclass
  ) THEN
    ALTER TABLE app_onework.events
      ADD CONSTRAINT events_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_source_mail_account_id_fkey'
      AND conrelid = 'app_onework.events'::regclass
  ) THEN
    ALTER TABLE app_onework.events
      ADD CONSTRAINT events_source_mail_account_id_fkey FOREIGN KEY (source_mail_account_id) REFERENCES app_onework.mail_accounts(id) ON DELETE SET NULL;
  END IF;

  ALTER TABLE app_onework.events
    DROP CONSTRAINT IF EXISTS events_project_id_fkey;

  ALTER TABLE app_onework.events
    ADD CONSTRAINT events_project_id_fkey FOREIGN KEY (project_id) REFERENCES app_onework.projects(id) ON DELETE CASCADE;
END $$;

GRANT ALL PRIVILEGES ON app_onework.calendars TO app_onework_user;
GRANT ALL PRIVILEGES ON app_onework.events TO app_onework_user;

CREATE INDEX IF NOT EXISTS events_workspace_time_idx
  ON app_onework.events(workspace_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS events_calendar_time_idx
  ON app_onework.events(calendar_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS events_project_time_idx
  ON app_onework.events(project_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS events_account_time_idx
  ON app_onework.events(account_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS events_source_mail_account_time_idx
  ON app_onework.events(source_mail_account_id, start_time, end_time);

CREATE UNIQUE INDEX IF NOT EXISTS events_account_source_message_idx
  ON app_onework.events(account_id, source_message_id)
  WHERE source = 'email' AND source_message_id IS NOT NULL;

ALTER TABLE app_onework.calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calendars_workspace_member_access" ON app_onework.calendars;
CREATE POLICY "calendars_workspace_member_access" ON app_onework.calendars
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.workspaces w
      LEFT JOIN app_onework.workspace_members wm
        ON wm.workspace_id = calendars.workspace_id
       AND wm.user_id = auth.uid()
      WHERE w.id = calendars.workspace_id
        AND (w.owner_id = auth.uid() OR wm.user_id = auth.uid())
    )
    OR public.is_max_member(auth.uid())
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM app_onework.workspaces w
      LEFT JOIN app_onework.workspace_members wm
        ON wm.workspace_id = calendars.workspace_id
       AND wm.user_id = auth.uid()
      WHERE w.id = calendars.workspace_id
        AND (w.owner_id = auth.uid() OR wm.user_id = auth.uid())
    )
    OR public.is_max_member(auth.uid())
  );

DROP POLICY IF EXISTS "events_workspace_member_access" ON app_onework.events;
CREATE POLICY "events_workspace_member_access" ON app_onework.events
  FOR ALL USING (
    (
      workspace_id IS NOT NULL
      AND EXISTS (
      SELECT 1
      FROM app_onework.workspaces w
      LEFT JOIN app_onework.workspace_members wm
        ON wm.workspace_id = events.workspace_id
       AND wm.user_id = auth.uid()
      WHERE w.id = events.workspace_id
        AND (w.owner_id = auth.uid() OR wm.user_id = auth.uid())
      )
    )
    OR (events.workspace_id IS NOT NULL AND public.is_max_member(auth.uid()))
    OR EXISTS (
      SELECT 1
      WHERE events.account_id = auth.uid()
    )
  )
  WITH CHECK (
    (
      workspace_id IS NOT NULL
      AND EXISTS (
      SELECT 1
      FROM app_onework.workspaces w
      LEFT JOIN app_onework.workspace_members wm
        ON wm.workspace_id = events.workspace_id
       AND wm.user_id = auth.uid()
      WHERE w.id = events.workspace_id
        AND (w.owner_id = auth.uid() OR wm.user_id = auth.uid())
      )
    )
    OR (events.workspace_id IS NOT NULL AND public.is_max_member(auth.uid()))
    OR EXISTS (
      SELECT 1
      WHERE events.account_id = auth.uid()
    )
  );

ALTER TABLE app_onework.event_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_attendees_select" ON app_onework.event_attendees;
CREATE POLICY "event_attendees_select" ON app_onework.event_attendees
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM app_onework.events ev
      JOIN app_onework.workspace_members wm ON wm.workspace_id = ev.workspace_id
      WHERE ev.id = event_attendees.event_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member(auth.uid())
  );

DROP POLICY IF EXISTS "event_attendees_write" ON app_onework.event_attendees;
CREATE POLICY "event_attendees_write" ON app_onework.event_attendees
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.events ev
      JOIN app_onework.workspace_members wm ON wm.workspace_id = ev.workspace_id
      WHERE ev.id = event_attendees.event_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member(auth.uid())
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM app_onework.events ev
      JOIN app_onework.workspace_members wm ON wm.workspace_id = ev.workspace_id
      WHERE ev.id = event_attendees.event_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member(auth.uid())
  );


-- ============================================
-- BLOCK 12: Billing & Subscriptions

CREATE TABLE IF NOT EXISTS app_onework.billing_plans (
    code                  VARCHAR(32) PRIMARY KEY,
    name                  TEXT NOT NULL,
    price_cents           INTEGER,
    currency              TEXT NOT NULL DEFAULT 'usd',
    interval              TEXT NOT NULL DEFAULT 'month',
    kelviq_variant_id     TEXT,
    max_projects          INTEGER,
    max_seats             INTEGER,
    max_channels          INTEGER,
    max_inboxes_per_user  INTEGER,
    max_storage_bytes     BIGINT NOT NULL DEFAULT 10485760,
    max_call_minutes_monthly BIGINT,
    max_call_duration_minutes INTEGER,
    analytics_level       TEXT NOT NULL DEFAULT 'none',
    ai_tier               TEXT NOT NULL DEFAULT 'none',
    support_tier          TEXT NOT NULL DEFAULT 'community',
    contact_sales         BOOLEAN NOT NULL DEFAULT false,
    is_active             BOOLEAN NOT NULL DEFAULT true,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_onework.billing_customers (
    id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id                 UUID NOT NULL UNIQUE REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
    kelviq_customer_id           TEXT,
    kelviq_customer_internal_id  TEXT,
    billing_email                TEXT,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS billing_customers_kelviq_internal_id_idx
    ON app_onework.billing_customers (kelviq_customer_internal_id)
    WHERE kelviq_customer_internal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_onework.workspace_subscriptions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id                UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
    plan_code                   VARCHAR(32) NOT NULL REFERENCES app_onework.billing_plans(code),
    kelviq_subscription_id      TEXT,
    status                      TEXT NOT NULL DEFAULT 'basic'
                                    CHECK (status IN ('basic','pending','active','past_due','canceled','trialing')),
    unit_price_cents            INTEGER,
    currency                    TEXT NOT NULL DEFAULT 'usd',
    current_period_end          TIMESTAMPTZ,
    cancel_at_period_end        BOOLEAN NOT NULL DEFAULT false,
    cancel_reason               TEXT,
    trial_ends_at               TIMESTAMPTZ,
    kelviq_object_updated_at    TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_subscriptions_one_live_per_workspace
    ON app_onework.workspace_subscriptions (workspace_id)
    WHERE status <> 'canceled';

CREATE INDEX IF NOT EXISTS workspace_subscriptions_workspace_id_idx
    ON app_onework.workspace_subscriptions (workspace_id);

CREATE TABLE IF NOT EXISTS app_onework.workspace_payment_methods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
    kelviq_pm_id    TEXT NOT NULL,
    brand           TEXT NOT NULL,
    last4           TEXT NOT NULL,
    exp_month       INTEGER NOT NULL,
    exp_year        INTEGER NOT NULL,
    is_default      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workspace_payment_methods_workspace_id_idx
    ON app_onework.workspace_payment_methods (workspace_id);

CREATE TABLE IF NOT EXISTS app_onework.billing_invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
    kelviq_invoice_id   TEXT NOT NULL,
    number              TEXT,
    amount_cents        INTEGER NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'usd',
    status              TEXT NOT NULL,
    hosted_url          TEXT,
    issued_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS billing_invoices_workspace_issued_idx
    ON app_onework.billing_invoices (workspace_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS app_onework.billing_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kelviq_event_id     TEXT NOT NULL UNIQUE,
    event_type          TEXT NOT NULL,
    workspace_id        UUID,
    payload             JSONB NOT NULL DEFAULT '{}',
    processed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_onework.billing_plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.billing_customers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.workspace_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.workspace_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.billing_invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.billing_events           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_plans_select_authenticated" ON app_onework.billing_plans;
CREATE POLICY "billing_plans_select_authenticated" ON app_onework.billing_plans
    FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "billing_customers_member_select" ON app_onework.billing_customers;
CREATE POLICY "billing_customers_member_select" ON app_onework.billing_customers
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM app_onework.workspace_members wm WHERE wm.workspace_id = billing_customers.workspace_id AND wm.user_id = auth.uid())
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "billing_customers_owner_admin_write" ON app_onework.billing_customers;
CREATE POLICY "billing_customers_owner_admin_write" ON app_onework.billing_customers
    FOR ALL USING (
        EXISTS (SELECT 1 FROM app_onework.workspaces w LEFT JOIN app_onework.workspace_members wm ON wm.workspace_id = billing_customers.workspace_id AND wm.user_id = auth.uid() WHERE w.id = billing_customers.workspace_id AND (w.owner_id = auth.uid() OR wm.role IN ('owner','admin')))
        OR public.is_max_member(auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM app_onework.workspaces w LEFT JOIN app_onework.workspace_members wm ON wm.workspace_id = billing_customers.workspace_id AND wm.user_id = auth.uid() WHERE w.id = billing_customers.workspace_id AND (w.owner_id = auth.uid() OR wm.role IN ('owner','admin')))
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "workspace_subscriptions_member_select" ON app_onework.workspace_subscriptions;
CREATE POLICY "workspace_subscriptions_member_select" ON app_onework.workspace_subscriptions
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM app_onework.workspace_members wm WHERE wm.workspace_id = workspace_subscriptions.workspace_id AND wm.user_id = auth.uid())
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "workspace_subscriptions_owner_admin_write" ON app_onework.workspace_subscriptions;
CREATE POLICY "workspace_subscriptions_owner_admin_write" ON app_onework.workspace_subscriptions
    FOR ALL USING (
        EXISTS (SELECT 1 FROM app_onework.workspaces w LEFT JOIN app_onework.workspace_members wm ON wm.workspace_id = workspace_subscriptions.workspace_id AND wm.user_id = auth.uid() WHERE w.id = workspace_subscriptions.workspace_id AND (w.owner_id = auth.uid() OR wm.role IN ('owner','admin')))
        OR public.is_max_member(auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM app_onework.workspaces w LEFT JOIN app_onework.workspace_members wm ON wm.workspace_id = workspace_subscriptions.workspace_id AND wm.user_id = auth.uid() WHERE w.id = workspace_subscriptions.workspace_id AND (w.owner_id = auth.uid() OR wm.role IN ('owner','admin')))
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "workspace_payment_methods_member_select" ON app_onework.workspace_payment_methods;
CREATE POLICY "workspace_payment_methods_member_select" ON app_onework.workspace_payment_methods
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM app_onework.workspace_members wm WHERE wm.workspace_id = workspace_payment_methods.workspace_id AND wm.user_id = auth.uid())
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "workspace_payment_methods_owner_admin_write" ON app_onework.workspace_payment_methods;
CREATE POLICY "workspace_payment_methods_owner_admin_write" ON app_onework.workspace_payment_methods
    FOR ALL USING (
        EXISTS (SELECT 1 FROM app_onework.workspaces w LEFT JOIN app_onework.workspace_members wm ON wm.workspace_id = workspace_payment_methods.workspace_id AND wm.user_id = auth.uid() WHERE w.id = workspace_payment_methods.workspace_id AND (w.owner_id = auth.uid() OR wm.role IN ('owner','admin')))
        OR public.is_max_member(auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM app_onework.workspaces w LEFT JOIN app_onework.workspace_members wm ON wm.workspace_id = workspace_payment_methods.workspace_id AND wm.user_id = auth.uid() WHERE w.id = workspace_payment_methods.workspace_id AND (w.owner_id = auth.uid() OR wm.role IN ('owner','admin')))
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "billing_invoices_member_select" ON app_onework.billing_invoices;
CREATE POLICY "billing_invoices_member_select" ON app_onework.billing_invoices
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM app_onework.workspace_members wm WHERE wm.workspace_id = billing_invoices.workspace_id AND wm.user_id = auth.uid())
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "billing_invoices_owner_admin_write" ON app_onework.billing_invoices;
CREATE POLICY "billing_invoices_owner_admin_write" ON app_onework.billing_invoices
    FOR ALL USING (
        EXISTS (SELECT 1 FROM app_onework.workspaces w LEFT JOIN app_onework.workspace_members wm ON wm.workspace_id = billing_invoices.workspace_id AND wm.user_id = auth.uid() WHERE w.id = billing_invoices.workspace_id AND (w.owner_id = auth.uid() OR wm.role IN ('owner','admin')))
        OR public.is_max_member(auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM app_onework.workspaces w LEFT JOIN app_onework.workspace_members wm ON wm.workspace_id = billing_invoices.workspace_id AND wm.user_id = auth.uid() WHERE w.id = billing_invoices.workspace_id AND (w.owner_id = auth.uid() OR wm.role IN ('owner','admin')))
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "billing_events_max_member_select" ON app_onework.billing_events;
CREATE POLICY "billing_events_max_member_select" ON app_onework.billing_events
    FOR SELECT USING (public.is_max_member(auth.uid()));

INSERT INTO app_onework.billing_plans
    (code, name, price_cents, currency, interval, max_projects, max_seats, max_channels, max_inboxes_per_user, max_storage_bytes, max_call_minutes_monthly, max_call_duration_minutes, analytics_level, ai_tier, support_tier, contact_sales, is_active, sort_order)
VALUES
    ('basic',      'Basic',      0,    'usd', 'month', 3,    3,    5,    1,    10485760,         10,     1,    'none',    'none',       'community',      false, true, 1),
    ('pro',        'Pro',        2900, 'usd', 'month', 50,   20,   50,   5,    1073741824,       10000,  1440, 'basic',   'task_intel', 'priority_email', false, true, 2),
    ('max',        'Max',        9900, 'usd', 'month', 50,   100,  500,  10,   21474836480,      50000,  1440, 'full_ai', 'full_suite', 'slack_24_7',     false, true, 3),
    ('enterprise', 'Enterprise', NULL, 'usd', 'month', NULL, NULL, NULL, NULL, 107374182400,     NULL,   NULL, 'custom',  'dedicated',  'dedicated_lead', true,  true, 4)
ON CONFLICT (code) DO UPDATE SET
    name                 = EXCLUDED.name,
    price_cents          = EXCLUDED.price_cents,
    max_projects         = EXCLUDED.max_projects,
    max_seats            = EXCLUDED.max_seats,
    max_channels         = EXCLUDED.max_channels,
    max_inboxes_per_user = EXCLUDED.max_inboxes_per_user,
    max_storage_bytes    = EXCLUDED.max_storage_bytes,
    max_call_minutes_monthly = EXCLUDED.max_call_minutes_monthly,
    max_call_duration_minutes = EXCLUDED.max_call_duration_minutes,
    analytics_level      = EXCLUDED.analytics_level,
    ai_tier              = EXCLUDED.ai_tier,
    support_tier         = EXCLUDED.support_tier,
    contact_sales        = EXCLUDED.contact_sales,
    sort_order           = EXCLUDED.sort_order,
    updated_at           = NOW();

INSERT INTO app_onework.workspace_subscriptions (workspace_id, plan_code, status)
SELECT w.id, 'basic', 'basic'
FROM app_onework.workspaces w
WHERE NOT EXISTS (
    SELECT 1 FROM app_onework.workspace_subscriptions s WHERE s.workspace_id = w.id
);

-- ============================================
-- BLOCK 13: Environment Vault (PROJECT-SCOPED, PRD v2.3)
-- Vault is project-scoped. workspace_id is denormalized on every
-- row for fast plan-tier and admin queries. RLS policies walk
-- project_id -> projects.workspace_id -> workspace_members.
-- ============================================

CREATE TABLE IF NOT EXISTS app_onework.vault_project_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL UNIQUE REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  wrapped_dek  TEXT        NOT NULL,
  dek_iv       TEXT        NOT NULL,
  dek_auth_tag TEXT        NOT NULL,
  algorithm    TEXT        NOT NULL DEFAULT 'aes-256-gcm',
  key_version  INTEGER     NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_project_keys_workspace ON app_onework.vault_project_keys(workspace_id);

CREATE TABLE IF NOT EXISTS app_onework.vault_environments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  description  TEXT,
  is_system    BOOLEAN     NOT NULL DEFAULT false,
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_vault_environments_project   ON app_onework.vault_environments(project_id);
CREATE INDEX IF NOT EXISTS idx_vault_environments_workspace ON app_onework.vault_environments(workspace_id);

CREATE TABLE IF NOT EXISTS app_onework.vault_variables (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id   UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  environment_id UUID        NOT NULL REFERENCES app_onework.vault_environments(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL CHECK (name ~ '^[A-Z_][A-Z0-9_]*$'),
  ciphertext     TEXT        NOT NULL,
  iv             TEXT        NOT NULL,
  auth_tag       TEXT        NOT NULL,
  algorithm      TEXT        NOT NULL DEFAULT 'aes-256-gcm',
  key_version    INTEGER     NOT NULL DEFAULT 1,
  created_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, environment_id, name)
);
CREATE INDEX IF NOT EXISTS idx_vault_variables_env       ON app_onework.vault_variables(environment_id);
CREATE INDEX IF NOT EXISTS idx_vault_variables_project   ON app_onework.vault_variables(project_id);
CREATE INDEX IF NOT EXISTS idx_vault_variables_workspace ON app_onework.vault_variables(workspace_id);

CREATE TABLE IF NOT EXISTS app_onework.vault_audit_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id   UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  actor_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL,
  resource_type  TEXT        NOT NULL DEFAULT 'variable',
  resource_id    UUID,
  environment_id UUID,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_audit_project   ON app_onework.vault_audit_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_audit_workspace ON app_onework.vault_audit_log(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_onework.vault_sync_targets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  provider     TEXT        NOT NULL DEFAULT 'github',
  config       JSONB       NOT NULL DEFAULT '{}',
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_sync_targets_project   ON app_onework.vault_sync_targets(project_id);
CREATE INDEX IF NOT EXISTS idx_vault_sync_targets_workspace ON app_onework.vault_sync_targets(workspace_id);

CREATE TABLE IF NOT EXISTS app_onework.vault_sync_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_target_id UUID        NOT NULL REFERENCES app_onework.vault_sync_targets(id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'pending',
  metadata       JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_onework.vault_cli_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL,
  scopes       TEXT[]      NOT NULL DEFAULT '{}',
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_cli_tokens_project   ON app_onework.vault_cli_tokens(project_id);
CREATE INDEX IF NOT EXISTS idx_vault_cli_tokens_workspace ON app_onework.vault_cli_tokens(workspace_id);

ALTER TABLE app_onework.vault_project_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_variables    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_sync_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_sync_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.vault_cli_tokens   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vault_project_keys_admin_select" ON app_onework.vault_project_keys;
CREATE POLICY "vault_project_keys_admin_select" ON app_onework.vault_project_keys
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspaces w ON w.id = p.workspace_id
            LEFT JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_project_keys.project_id
              AND (w.owner_id = auth.uid() OR wm.role = 'admin')
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_environments_member_select" ON app_onework.vault_environments;
CREATE POLICY "vault_environments_member_select" ON app_onework.vault_environments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_environments.project_id
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_environments_admin_write" ON app_onework.vault_environments;
CREATE POLICY "vault_environments_admin_write" ON app_onework.vault_environments
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspaces w ON w.id = p.workspace_id
            LEFT JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_environments.project_id
              AND (w.owner_id = auth.uid() OR wm.role = 'admin')
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_variables_member_select" ON app_onework.vault_variables;
CREATE POLICY "vault_variables_member_select" ON app_onework.vault_variables
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_variables.project_id
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_variables_admin_write" ON app_onework.vault_variables;
CREATE POLICY "vault_variables_admin_write" ON app_onework.vault_variables
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspaces w ON w.id = p.workspace_id
            LEFT JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_variables.project_id
              AND (w.owner_id = auth.uid() OR wm.role = 'admin')
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_audit_log_admin_select" ON app_onework.vault_audit_log;
CREATE POLICY "vault_audit_log_admin_select" ON app_onework.vault_audit_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.projects p
            JOIN app_onework.workspaces w ON w.id = p.workspace_id
            LEFT JOIN app_onework.workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = auth.uid()
            WHERE p.id = vault_audit_log.project_id
              AND (w.owner_id = auth.uid() OR wm.role = 'admin')
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "vault_sync_targets_admin" ON app_onework.vault_sync_targets;
CREATE POLICY "vault_sync_targets_admin" ON app_onework.vault_sync_targets
    FOR ALL USING (public.is_max_member(auth.uid()));

DROP POLICY IF EXISTS "vault_sync_events_admin" ON app_onework.vault_sync_events;
CREATE POLICY "vault_sync_events_admin" ON app_onework.vault_sync_events
    FOR ALL USING (public.is_max_member(auth.uid()));

DROP POLICY IF EXISTS "vault_cli_tokens_owner" ON app_onework.vault_cli_tokens;
CREATE POLICY "vault_cli_tokens_owner" ON app_onework.vault_cli_tokens
    FOR ALL USING (user_id = auth.uid() OR public.is_max_member(auth.uid()));


-- ============================================================
-- BLOCK 14: vercel_integrations
-- ============================================================
CREATE TABLE IF NOT EXISTS app_onework.vercel_integrations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  connected_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  connection_scope  TEXT        NOT NULL DEFAULT 'team' CHECK (connection_scope IN ('team', 'user')),
  target_id         TEXT        NOT NULL,
  target_name       TEXT,
  access_token_enc  TEXT        NOT NULL,
  refresh_token_enc TEXT,
  token_type        TEXT        NOT NULL DEFAULT 'Bearer',
  scope             TEXT,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, connection_scope, target_id)
);
CREATE INDEX IF NOT EXISTS idx_vercel_integrations_workspace
  ON app_onework.vercel_integrations(workspace_id);
ALTER TABLE app_onework.vercel_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vercel_integrations_admin" ON app_onework.vercel_integrations;
CREATE POLICY "vercel_integrations_admin" ON app_onework.vercel_integrations
  USING (public.is_max_member(workspace_id));


-- ============================================================
-- BLOCK 14b: git_repo_vercel_deployments (VC ↔ Vercel CI/CD)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_onework.git_repo_vercel_deployments (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID        NOT NULL REFERENCES app_onework.projects(id) ON DELETE CASCADE,
  workspace_id          UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  git_provider          TEXT        NOT NULL CHECK (git_provider IN ('onework')),
  repo_owner            TEXT        NOT NULL,
  repo_name             TEXT        NOT NULL,
  repo_full_name        TEXT        NOT NULL,
  vercel_project_id     TEXT        NOT NULL,
  vercel_project_name   TEXT        NOT NULL,
  production_branch     TEXT        NOT NULL DEFAULT 'main',
  gitea_deploy_token_enc TEXT,
  vercel_webhook_id     TEXT,
  enabled               BOOLEAN     NOT NULL DEFAULT true,
  created_by            UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, git_provider, repo_full_name)
);
CREATE INDEX IF NOT EXISTS idx_git_repo_vercel_deployments_project
  ON app_onework.git_repo_vercel_deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_git_repo_vercel_deployments_workspace
  ON app_onework.git_repo_vercel_deployments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_git_repo_vercel_deployments_repo
  ON app_onework.git_repo_vercel_deployments(repo_full_name);
ALTER TABLE app_onework.git_repo_vercel_deployments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "git_repo_vercel_deployments_member" ON app_onework.git_repo_vercel_deployments;
CREATE POLICY "git_repo_vercel_deployments_member" ON app_onework.git_repo_vercel_deployments
  USING (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = git_repo_vercel_deployments.workspace_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member()
  );


-- ============================================================
-- BLOCK 15: Team Analytics Support
-- ============================================================
ALTER TABLE app_onework.tasks
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

UPDATE app_onework.tasks
SET completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE status = 'done'
  AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_completed_at
  ON app_onework.tasks(workspace_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_onework.teams (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  lead_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_teams_workspace
  ON app_onework.teams(workspace_id, name);

CREATE TABLE IF NOT EXISTS app_onework.team_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES app_onework.teams(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team
  ON app_onework.team_members(team_id);

CREATE INDEX IF NOT EXISTS idx_team_members_user
  ON app_onework.team_members(user_id);

GRANT ALL PRIVILEGES ON app_onework.teams TO app_onework_user;
GRANT ALL PRIVILEGES ON app_onework.team_members TO app_onework_user;

ALTER TABLE app_onework.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teams_member_select" ON app_onework.teams;
CREATE POLICY "teams_member_select" ON app_onework.teams
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = teams.workspace_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member(auth.uid())
  );

DROP POLICY IF EXISTS "teams_admin_write" ON app_onework.teams;
CREATE POLICY "teams_admin_write" ON app_onework.teams
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.workspaces w
      LEFT JOIN app_onework.workspace_members wm
        ON wm.workspace_id = teams.workspace_id
       AND wm.user_id = auth.uid()
      WHERE w.id = teams.workspace_id
        AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
    )
    OR public.is_max_member(auth.uid())
  );

DROP POLICY IF EXISTS "team_members_member_select" ON app_onework.team_members;
CREATE POLICY "team_members_member_select" ON app_onework.team_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM app_onework.teams t
      JOIN app_onework.workspace_members wm
        ON wm.workspace_id = t.workspace_id
      WHERE t.id = team_members.team_id
        AND wm.user_id = auth.uid()
    )
    OR public.is_max_member(auth.uid())
  );

DROP POLICY IF EXISTS "team_members_admin_write" ON app_onework.team_members;
CREATE POLICY "team_members_admin_write" ON app_onework.team_members
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.teams t
      JOIN app_onework.workspaces w ON w.id = t.workspace_id
      LEFT JOIN app_onework.workspace_members wm
        ON wm.workspace_id = t.workspace_id
       AND wm.user_id = auth.uid()
      WHERE t.id = team_members.team_id
        AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
    )
    OR public.is_max_member(auth.uid())
  );
