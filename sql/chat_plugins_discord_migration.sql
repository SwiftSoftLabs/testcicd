-- Allow Discord as a chat plugin provider (run after chat_plugins_teams_migration.sql).

ALTER TABLE app_onework.chat_plugin_installations
  DROP CONSTRAINT IF EXISTS chat_plugin_installations_provider_check;

ALTER TABLE app_onework.chat_plugin_installations
  ADD CONSTRAINT chat_plugin_installations_provider_check
  CHECK (provider IN ('slack', 'teams', 'discord'));
