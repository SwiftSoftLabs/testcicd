-- Atomic DM get-or-create (prevents parallel POST race duplicates).
-- Run in DBeaver against app_onework, then reload chat.

CREATE OR REPLACE FUNCTION app_onework.get_or_create_dm(
  p_workspace_id UUID,
  p_user_a UUID,
  p_user_b UUID,
  p_created_by UUID,
  p_name TEXT DEFAULT 'Direct Message'
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  type TEXT,
  workspace_id UUID,
  created_at TIMESTAMPTZ,
  description TEXT,
  is_existing BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_low TEXT;
  v_high TEXT;
  v_conv_id UUID;
  v_conv_name TEXT;
  v_conv_created TIMESTAMPTZ;
  v_conv_desc TEXT;
BEGIN
  IF p_user_a = p_user_b THEN
    RAISE EXCEPTION 'DM requires two distinct users';
  END IF;

  IF p_user_a::text < p_user_b::text THEN
    v_low := p_user_a::text;
    v_high := p_user_b::text;
  ELSE
    v_low := p_user_b::text;
    v_high := p_user_a::text;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_workspace_id::text || ':' || v_low || ':' || v_high));

  SELECT c.id, c.name, c.created_at, COALESCE(c.description, '')
    INTO v_conv_id, v_conv_name, v_conv_created, v_conv_desc
  FROM app_onework.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.type = 'dm'
    AND c.archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM app_onework.conversation_members cm
      WHERE cm.conversation_id = c.id AND cm.user_id = p_user_a AND cm.left_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM app_onework.conversation_members cm
      WHERE cm.conversation_id = c.id AND cm.user_id = p_user_b AND cm.left_at IS NULL
    )
  ORDER BY c.created_at ASC
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN QUERY
      SELECT v_conv_id, v_conv_name, 'dm'::TEXT, p_workspace_id, v_conv_created, v_conv_desc, TRUE;
    RETURN;
  END IF;

  INSERT INTO app_onework.conversations (workspace_id, type, name, description, created_by)
  VALUES (
    p_workspace_id,
    'dm',
    COALESCE(NULLIF(TRIM(p_name), ''), 'Direct Message'),
    '',
    p_created_by
  )
  RETURNING
    app_onework.conversations.id,
    app_onework.conversations.name,
    app_onework.conversations.created_at,
    COALESCE(app_onework.conversations.description, '')
  INTO v_conv_id, v_conv_name, v_conv_created, v_conv_desc;

  INSERT INTO app_onework.conversation_members (conversation_id, user_id, role)
  VALUES (v_conv_id, p_created_by, 'admin')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  IF p_user_a <> p_created_by THEN
    INSERT INTO app_onework.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv_id, p_user_a, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  IF p_user_b <> p_created_by THEN
    INSERT INTO app_onework.conversation_members (conversation_id, user_id, role)
    VALUES (v_conv_id, p_user_b, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT v_conv_id, v_conv_name, 'dm'::TEXT, p_workspace_id, v_conv_created, v_conv_desc, FALSE;
END;
$$;

-- Optional one-time cleanup: archive duplicate DMs (keeps thread with most messages, else oldest).
-- Review counts before running in production.
/*
WITH dm_members AS (
  SELECT
    c.id AS conversation_id,
    c.workspace_id,
    c.created_at,
    array_agg(cm.user_id ORDER BY cm.user_id::text) AS member_ids,
    (
      SELECT COUNT(*)
      FROM app_onework.messages m
      WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
    ) AS msg_count
  FROM app_onework.conversations c
  JOIN app_onework.conversation_members cm
    ON cm.conversation_id = c.id AND cm.left_at IS NULL
  WHERE c.type = 'dm' AND c.archived_at IS NULL
  GROUP BY c.id, c.workspace_id, c.created_at
  HAVING COUNT(*) = 2
),
ranked AS (
  SELECT
    conversation_id,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, member_ids
      ORDER BY msg_count DESC, created_at ASC
    ) AS rn
  FROM dm_members
)
UPDATE app_onework.conversations c
SET archived_at = NOW(), updated_at = NOW()
FROM ranked r
WHERE c.id = r.conversation_id AND r.rn > 1;
*/
