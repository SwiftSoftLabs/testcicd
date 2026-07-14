-- Slack-style thread replies for chat messages
-- Run against app_onework schema

ALTER TABLE app_onework.messages
  ADD COLUMN IF NOT EXISTS thread_root_message_id UUID REFERENCES app_onework.messages(id),
  ADD COLUMN IF NOT EXISTS also_sent_to_channel BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reply_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_thread_root
  ON app_onework.messages (thread_root_message_id, created_at)
  WHERE thread_root_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_channel_timeline
  ON app_onework.messages (conversation_id, created_at)
  WHERE deleted_at IS NULL
    AND (thread_root_message_id IS NULL OR also_sent_to_channel = true);

-- Step 1: existing inline replies → thread replies (direct parent)
UPDATE app_onework.messages m
SET thread_root_message_id = m.reply_to_message_id
WHERE m.reply_to_message_id IS NOT NULL
  AND m.thread_root_message_id IS NULL;

-- Step 2: flatten reply chains to root (reply-to-reply → root parent)
WITH RECURSIVE reply_chain AS (
  SELECT id, reply_to_message_id AS parent_id, id AS start_id
  FROM app_onework.messages
  WHERE reply_to_message_id IS NOT NULL
    AND thread_root_message_id IS NOT NULL
  UNION ALL
  SELECT rc.start_id, p.reply_to_message_id, rc.start_id
  FROM reply_chain rc
  JOIN app_onework.messages p ON p.id = rc.parent_id
  WHERE p.reply_to_message_id IS NOT NULL
),
roots AS (
  SELECT DISTINCT ON (start_id) start_id AS id, parent_id AS root_id
  FROM reply_chain
  WHERE parent_id IS NOT NULL
  ORDER BY start_id, parent_id
)
UPDATE app_onework.messages m
SET thread_root_message_id = r.root_id
FROM roots r
WHERE m.id = r.id
  AND EXISTS (
    SELECT 1 FROM app_onework.messages root
    WHERE root.id = r.root_id AND root.reply_to_message_id IS NULL
  );

-- Step 3: backfill reply_count and last_reply_at on parent messages
UPDATE app_onework.messages p
SET reply_count = sub.cnt,
    last_reply_at = sub.latest
FROM (
  SELECT thread_root_message_id AS id,
         COUNT(*)::int AS cnt,
         MAX(created_at) AS latest
  FROM app_onework.messages
  WHERE thread_root_message_id IS NOT NULL
    AND deleted_at IS NULL
  GROUP BY thread_root_message_id
) sub
WHERE p.id = sub.id;
