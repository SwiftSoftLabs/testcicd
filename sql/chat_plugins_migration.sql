-- Chat platform plugins (Slack MVP) — workspace-scoped installations and channel links.

CREATE TABLE IF NOT EXISTS app_onework.chat_plugin_installations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  installed_by        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('slack')),
  team_id             TEXT NOT NULL,
  team_name           TEXT,
  bot_user_id         TEXT,
  encrypted_token     TEXT NOT NULL,
  encrypted_refresh   TEXT,
  status              TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'revoked')),
  settings            JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_cursor         JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at      TIMESTAMPTZ,
  last_sync_error     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS app_onework.plugin_conversation_links (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id       UUID NOT NULL REFERENCES app_onework.chat_plugin_installations(id) ON DELETE CASCADE,
  conversation_id       UUID NOT NULL REFERENCES app_onework.conversations(id) ON DELETE CASCADE,
  external_channel_id   TEXT NOT NULL,
  external_channel_name TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (installation_id, external_channel_id),
  UNIQUE (conversation_id)
);

CREATE TABLE IF NOT EXISTS app_onework.plugin_message_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id     UUID NOT NULL REFERENCES app_onework.chat_plugin_installations(id) ON DELETE CASCADE,
  message_id          UUID NOT NULL REFERENCES app_onework.messages(id) ON DELETE CASCADE,
  external_message_id TEXT NOT NULL,
  sync_origin         TEXT NOT NULL DEFAULT 'import' CHECK (sync_origin IN ('import', 'export')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (installation_id, external_message_id),
  UNIQUE (message_id)
);

CREATE INDEX IF NOT EXISTS chat_plugin_installations_workspace_idx
  ON app_onework.chat_plugin_installations(workspace_id, provider);

CREATE INDEX IF NOT EXISTS plugin_conversation_links_installation_idx
  ON app_onework.plugin_conversation_links(installation_id);

CREATE INDEX IF NOT EXISTS plugin_message_links_installation_idx
  ON app_onework.plugin_message_links(installation_id);

GRANT ALL PRIVILEGES ON app_onework.chat_plugin_installations TO app_onework_user;
GRANT ALL PRIVILEGES ON app_onework.plugin_conversation_links TO app_onework_user;
GRANT ALL PRIVILEGES ON app_onework.plugin_message_links TO app_onework_user;

ALTER TABLE app_onework.chat_plugin_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.plugin_conversation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.plugin_message_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_plugin_installations_member_access" ON app_onework.chat_plugin_installations;
CREATE POLICY "chat_plugin_installations_member_access" ON app_onework.chat_plugin_installations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = chat_plugin_installations.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_onework.workspace_members wm
      WHERE wm.workspace_id = chat_plugin_installations.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "plugin_conversation_links_member_access" ON app_onework.plugin_conversation_links;
CREATE POLICY "plugin_conversation_links_member_access" ON app_onework.plugin_conversation_links
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.chat_plugin_installations i
      JOIN app_onework.workspace_members wm ON wm.workspace_id = i.workspace_id
      WHERE i.id = plugin_conversation_links.installation_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM app_onework.chat_plugin_installations i
      JOIN app_onework.workspace_members wm ON wm.workspace_id = i.workspace_id
      WHERE i.id = plugin_conversation_links.installation_id
        AND wm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "plugin_message_links_member_access" ON app_onework.plugin_message_links;
CREATE POLICY "plugin_message_links_member_access" ON app_onework.plugin_message_links
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM app_onework.chat_plugin_installations i
      JOIN app_onework.workspace_members wm ON wm.workspace_id = i.workspace_id
      WHERE i.id = plugin_message_links.installation_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM app_onework.chat_plugin_installations i
      JOIN app_onework.workspace_members wm ON wm.workspace_id = i.workspace_id
      WHERE i.id = plugin_message_links.installation_id
        AND wm.user_id = auth.uid()
    )
  );
