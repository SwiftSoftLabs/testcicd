-- Fix: hosts could not invite others to calls (500 on POST /api/calls with participant_ids).
-- The old insert policy only allowed user_id = auth.uid(), blocking host-added invitees.
-- RUN MANUALLY in InsForge against app_onework schema.

DROP POLICY IF EXISTS "call_participants_insert" ON app_onework.call_participants;
CREATE POLICY "call_participants_insert" ON app_onework.call_participants
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = call_participants.call_session_id
              AND wm.user_id = auth.uid()
        )
        AND (
            user_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM app_onework.call_sessions cs
                WHERE cs.id = call_participants.call_session_id
                  AND cs.created_by = auth.uid()
            )
        )
    );
