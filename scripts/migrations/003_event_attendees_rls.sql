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
