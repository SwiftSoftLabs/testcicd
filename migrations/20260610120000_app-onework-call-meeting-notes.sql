-- OneWork: In-call manual meeting notes (public + private per user)
-- Schema: app_onework

CREATE TABLE IF NOT EXISTS app_onework.call_public_meeting_notes (
    call_session_id  UUID        PRIMARY KEY
        REFERENCES app_onework.call_sessions(id) ON DELETE CASCADE,
    content          TEXT        NOT NULL DEFAULT '',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_onework.call_private_meeting_notes (
    call_session_id  UUID        NOT NULL
        REFERENCES app_onework.call_sessions(id) ON DELETE CASCADE,
    user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content          TEXT        NOT NULL DEFAULT '',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (call_session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_call_private_meeting_notes_user
    ON app_onework.call_private_meeting_notes(user_id);

-- RLS: workspace members on the call's workspace can access notes
ALTER TABLE app_onework.call_public_meeting_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.call_private_meeting_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_public_meeting_notes_read" ON app_onework.call_public_meeting_notes;
CREATE POLICY "call_public_meeting_notes_read" ON app_onework.call_public_meeting_notes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = call_public_meeting_notes.call_session_id
              AND wm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "call_public_meeting_notes_write" ON app_onework.call_public_meeting_notes;
CREATE POLICY "call_public_meeting_notes_write" ON app_onework.call_public_meeting_notes
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = call_public_meeting_notes.call_session_id
              AND wm.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = call_public_meeting_notes.call_session_id
              AND wm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "call_private_meeting_notes_read" ON app_onework.call_private_meeting_notes;
CREATE POLICY "call_private_meeting_notes_read" ON app_onework.call_private_meeting_notes
    FOR SELECT USING (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = call_private_meeting_notes.call_session_id
              AND wm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "call_private_meeting_notes_write" ON app_onework.call_private_meeting_notes;
CREATE POLICY "call_private_meeting_notes_write" ON app_onework.call_private_meeting_notes
    FOR ALL USING (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = call_private_meeting_notes.call_session_id
              AND wm.user_id = auth.uid()
        )
    )
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = call_private_meeting_notes.call_session_id
              AND wm.user_id = auth.uid()
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.call_public_meeting_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_onework.call_private_meeting_notes TO authenticated;
