-- Local snooze metadata for synced mailbox messages (not stored on IMAP server).
ALTER TABLE app_onework.mail_messages
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mail_messages_account_snoozed
  ON app_onework.mail_messages (account_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;

-- Legacy internal emails table (when no connected mailbox).
ALTER TABLE app_onework.emails
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;
