CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON app_onework.messages (conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conv_sender_created
  ON app_onework.messages (conversation_id, sender_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conv_members_user_conv
  ON app_onework.conversation_members (user_id, conversation_id)
  WHERE left_at IS NULL;
