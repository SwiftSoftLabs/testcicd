-- Add provider-native message id for Gmail API / Microsoft Graph operations.
ALTER TABLE app_onework.mail_messages
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_mail_messages_account_provider_message_id
  ON app_onework.mail_messages(account_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
