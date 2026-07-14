GRANT USAGE ON SCHEMA app_onework TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.commits             TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.conversations       TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.conversation_members TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.messages            TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.message_mentions    TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.notifications       TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.pull_requests       TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.emails              TO authenticated;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA app_onework TO authenticated;

CREATE OR REPLACE VIEW public.onework_notifications
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.notifications;

CREATE OR REPLACE VIEW public.onework_commits
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.commits;

CREATE OR REPLACE VIEW public.onework_pull_requests
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.pull_requests;

CREATE OR REPLACE VIEW public.onework_conversations
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.conversations;

CREATE OR REPLACE VIEW public.onework_conversation_members
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.conversation_members;

CREATE OR REPLACE VIEW public.onework_messages
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.messages;

CREATE OR REPLACE VIEW public.onework_emails
  WITH (security_invoker = true)
AS SELECT * FROM app_onework.emails;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_notifications         TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_commits               TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_pull_requests         TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_conversations         TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_conversation_members  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_messages              TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_emails                TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_profiles              TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_workspaces            TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_workspace_members     TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_projects              TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_tasks                 TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_task_activities       TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onework_teams                 TO authenticated;

ALTER TABLE app_onework.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON app_onework.notifications;

CREATE POLICY "Users can view own notifications"
  ON app_onework.notifications FOR SELECT
  USING (user_id = auth.uid() OR public.is_max_member());

DROP POLICY IF EXISTS "Users can mark own notifications as read" ON app_onework.notifications;

CREATE POLICY "Users can mark own notifications as read"
  ON app_onework.notifications FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "System can insert notifications" ON app_onework.notifications;

CREATE POLICY "System can insert notifications"
  ON app_onework.notifications FOR INSERT
  WITH CHECK (true);

ALTER TABLE app_onework.commits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Commits viewable by project workspace members" ON app_onework.commits;

CREATE POLICY "Commits viewable by project workspace members"
  ON app_onework.commits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_onework.projects p
      JOIN app_onework.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = commits.project_id AND wm.user_id = auth.uid()
    )
    OR public.is_max_member()
  );

DROP POLICY IF EXISTS "Commits can be inserted by workspace members" ON app_onework.commits;

CREATE POLICY "Commits can be inserted by workspace members"
  ON app_onework.commits FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_onework.projects p
      JOIN app_onework.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = commits.project_id AND wm.user_id = auth.uid()
    )
    OR public.is_max_member()
  );

ALTER TABLE app_onework.pull_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pull requests viewable by project workspace members" ON app_onework.pull_requests;

CREATE POLICY "Pull requests viewable by project workspace members"
  ON app_onework.pull_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_onework.projects p
      JOIN app_onework.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = pull_requests.project_id AND wm.user_id = auth.uid()
    )
    OR public.is_max_member()
  );

DROP POLICY IF EXISTS "Pull requests can be managed by workspace members" ON app_onework.pull_requests;

CREATE POLICY "Pull requests can be managed by workspace members"
  ON app_onework.pull_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app_onework.projects p
      JOIN app_onework.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE p.id = pull_requests.project_id AND wm.user_id = auth.uid()
    )
    OR public.is_max_member()
  );

ALTER TABLE app_onework.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Conversations viewable by workspace members" ON app_onework.conversations;

CREATE POLICY "Conversations viewable by workspace members"
  ON app_onework.conversations FOR SELECT
  USING (
    public.onework_is_workspace_member(workspace_id)
    OR public.is_max_member()
  );

DROP POLICY IF EXISTS "Conversations can be created by workspace members" ON app_onework.conversations;

CREATE POLICY "Conversations can be created by workspace members"
  ON app_onework.conversations FOR INSERT
  WITH CHECK (
    public.onework_is_workspace_member(workspace_id)
    OR public.is_max_member()
  );

ALTER TABLE app_onework.conversation_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Conversation members viewable by participants" ON app_onework.conversation_members;

CREATE POLICY "Conversation members viewable by participants"
  ON app_onework.conversation_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM app_onework.conversation_members cm2
      WHERE cm2.conversation_id = conversation_members.conversation_id
        AND cm2.user_id = auth.uid()
    )
    OR public.is_max_member()
  );

DROP POLICY IF EXISTS "Conversation members can be added" ON app_onework.conversation_members;

CREATE POLICY "Conversation members can be added"
  ON app_onework.conversation_members FOR INSERT
  WITH CHECK (true);

ALTER TABLE app_onework.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Messages viewable by conversation participants" ON app_onework.messages;

CREATE POLICY "Messages viewable by conversation participants"
  ON app_onework.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app_onework.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_id = auth.uid()
    )
    OR public.is_max_member()
  );

DROP POLICY IF EXISTS "Messages can be sent by conversation participants" ON app_onework.messages;

CREATE POLICY "Messages can be sent by conversation participants"
  ON app_onework.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM app_onework.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_id = auth.uid()
    )
  );

ALTER TABLE app_onework.emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Emails viewable by sender or recipient" ON app_onework.emails;

CREATE POLICY "Emails viewable by sender or recipient"
  ON app_onework.emails FOR SELECT
  USING (
    sender_id = auth.uid()
    OR recipient_id = auth.uid()
    OR public.is_max_member()
  );

DROP POLICY IF EXISTS "Emails can be sent by authenticated users" ON app_onework.emails;

CREATE POLICY "Emails can be sent by authenticated users"
  ON app_onework.emails FOR INSERT
  WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "Emails can be updated by sender or recipient" ON app_onework.emails;

CREATE POLICY "Emails can be updated by sender or recipient"
  ON app_onework.emails FOR UPDATE
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());
