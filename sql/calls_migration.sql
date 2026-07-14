-- OneWork: Video calls + meeting AI (historical reference)
-- Prefer migrations/20260609120000_app-onework-livekit-columns.sql for LiveKit columns.
-- RUN MANUALLY in InsForge dashboard against app_onework schema.

-- Workspace settings for calls
ALTER TABLE app_onework.workspaces
    ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Call sessions
CREATE TABLE IF NOT EXISTS app_onework.call_sessions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
    project_id          UUID        REFERENCES app_onework.projects(id) ON DELETE SET NULL,
    conversation_id     UUID        REFERENCES app_onework.conversations(id) ON DELETE SET NULL,
    calendar_event_id   UUID        REFERENCES app_onework.events(id) ON DELETE SET NULL,
    created_by          UUID        NOT NULL REFERENCES auth.users(id),
    title               TEXT        NOT NULL DEFAULT 'Meeting',
    type                TEXT        NOT NULL DEFAULT 'instant_group'
        CHECK (type IN ('instant_1_1', 'instant_group', 'scheduled')),
    status              TEXT        NOT NULL DEFAULT 'lobby'
        CHECK (status IN ('scheduled', 'lobby', 'live', 'processing', 'completed', 'failed', 'cancelled')),
    agora_channel_name  TEXT,
    agora_agent_id      TEXT,
    ai_mode             TEXT        NOT NULL DEFAULT 'voice_agent',
    scheduled_start_at  TIMESTAMPTZ,
    scheduled_end_at    TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    recording_enabled   BOOLEAN     NOT NULL DEFAULT true,
    ai_enabled          BOOLEAN     NOT NULL DEFAULT true,
    metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_workspace_status
    ON app_onework.call_sessions(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_call_sessions_workspace_scheduled
    ON app_onework.call_sessions(workspace_id, scheduled_start_at)
    WHERE scheduled_start_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_sessions_conversation
    ON app_onework.call_sessions(conversation_id)
    WHERE conversation_id IS NOT NULL;

-- Participants
CREATE TABLE IF NOT EXISTS app_onework.call_participants (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    call_session_id  UUID        NOT NULL REFERENCES app_onework.call_sessions(id) ON DELETE CASCADE,
    user_id          UUID        NOT NULL REFERENCES auth.users(id),
    role             TEXT        NOT NULL DEFAULT 'participant'
        CHECK (role IN ('host', 'cohost', 'participant')),
    agora_uid        BIGINT,
    joined_at        TIMESTAMPTZ,
    left_at          TIMESTAMPTZ,
    consent_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(call_session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_call_participants_call
    ON app_onework.call_participants(call_session_id);

CREATE INDEX IF NOT EXISTS idx_call_participants_user
    ON app_onework.call_participants(user_id);

-- Recordings
CREATE TABLE IF NOT EXISTS app_onework.call_recordings (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    call_session_id  UUID        NOT NULL REFERENCES app_onework.call_sessions(id) ON DELETE CASCADE,
    workspace_file_id UUID        REFERENCES app_onework.workspace_files(id) ON DELETE SET NULL,
    storage_key      TEXT,
    playback_url     TEXT,
    duration_seconds INT,
    file_size_bytes  BIGINT,
    agora_resource_id TEXT,
    agora_sid        TEXT,
    status           TEXT        NOT NULL DEFAULT 'recording'
        CHECK (status IN ('recording', 'uploaded', 'failed')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_recordings_session
    ON app_onework.call_recordings(call_session_id);

-- Transcripts
CREATE TABLE IF NOT EXISTS app_onework.call_transcripts (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    call_session_id  UUID        NOT NULL REFERENCES app_onework.call_sessions(id) ON DELETE CASCADE,
    full_text        TEXT,
    segments         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    language         TEXT        NOT NULL DEFAULT 'en',
    status           TEXT        NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'ready', 'failed')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_transcripts_session
    ON app_onework.call_transcripts(call_session_id);

-- AI artifacts
CREATE TABLE IF NOT EXISTS app_onework.call_ai_artifacts (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    call_session_id  UUID        NOT NULL REFERENCES app_onework.call_sessions(id) ON DELETE CASCADE,
    summary          TEXT,
    key_decisions    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    live_notes       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    raw_response     JSONB,
    model_id         TEXT,
    status           TEXT        NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'ready', 'failed', 'skipped')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_ai_artifacts_session
    ON app_onework.call_ai_artifacts(call_session_id);

-- Meeting task reviews
CREATE TABLE IF NOT EXISTS app_onework.meeting_task_reviews (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    call_session_id  UUID        NOT NULL REFERENCES app_onework.call_sessions(id) ON DELETE CASCADE,
    task_id          UUID        NOT NULL REFERENCES app_onework.tasks(id) ON DELETE CASCADE,
    review_status    TEXT        NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending', 'acknowledged', 'approved', 'rejected')),
    reviewed_by      UUID        REFERENCES auth.users(id),
    reviewed_at      TIMESTAMPTZ,
    ai_confidence    NUMERIC,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(call_session_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_task_reviews_call
    ON app_onework.meeting_task_reviews(call_session_id);

CREATE INDEX IF NOT EXISTS idx_meeting_task_reviews_status
    ON app_onework.meeting_task_reviews(review_status)
    WHERE review_status = 'pending';

-- Calendar + tasks extensions
ALTER TABLE app_onework.events
    ADD COLUMN IF NOT EXISTS call_session_id UUID
        REFERENCES app_onework.call_sessions(id) ON DELETE SET NULL;

ALTER TABLE app_onework.tasks
    ADD COLUMN IF NOT EXISTS source_call_id UUID
        REFERENCES app_onework.call_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_source_call
    ON app_onework.tasks(source_call_id)
    WHERE source_call_id IS NOT NULL;

-- RLS helper: workspace member
-- call_sessions
ALTER TABLE app_onework.call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_sessions_read" ON app_onework.call_sessions;
CREATE POLICY "call_sessions_read" ON app_onework.call_sessions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspace_members wm
            WHERE wm.workspace_id = call_sessions.workspace_id
              AND wm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "call_sessions_insert" ON app_onework.call_sessions;
CREATE POLICY "call_sessions_insert" ON app_onework.call_sessions
    FOR INSERT WITH CHECK (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM app_onework.workspace_members wm
            WHERE wm.workspace_id = call_sessions.workspace_id
              AND wm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "call_sessions_update" ON app_onework.call_sessions;
CREATE POLICY "call_sessions_update" ON app_onework.call_sessions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspace_members wm
            WHERE wm.workspace_id = call_sessions.workspace_id
              AND wm.user_id = auth.uid()
        )
    );

-- call_participants
ALTER TABLE app_onework.call_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_participants_read" ON app_onework.call_participants;
CREATE POLICY "call_participants_read" ON app_onework.call_participants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = call_participants.call_session_id
              AND wm.user_id = auth.uid()
        )
    );

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

DROP POLICY IF EXISTS "call_participants_update" ON app_onework.call_participants;
CREATE POLICY "call_participants_update" ON app_onework.call_participants
    FOR UPDATE USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            WHERE cs.id = call_participants.call_session_id
              AND cs.created_by = auth.uid()
        )
    );

-- call_recordings, call_transcripts, call_ai_artifacts, meeting_task_reviews (read via session membership)
ALTER TABLE app_onework.call_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.call_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.call_ai_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_onework.meeting_task_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_recordings_read" ON app_onework.call_recordings;
CREATE POLICY "call_recordings_read" ON app_onework.call_recordings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = call_recordings.call_session_id
              AND wm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "call_transcripts_read" ON app_onework.call_transcripts;
CREATE POLICY "call_transcripts_read" ON app_onework.call_transcripts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = call_transcripts.call_session_id
              AND wm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "call_ai_artifacts_read" ON app_onework.call_ai_artifacts;
CREATE POLICY "call_ai_artifacts_read" ON app_onework.call_ai_artifacts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = call_ai_artifacts.call_session_id
              AND wm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "meeting_task_reviews_read" ON app_onework.meeting_task_reviews;
CREATE POLICY "meeting_task_reviews_read" ON app_onework.meeting_task_reviews
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = meeting_task_reviews.call_session_id
              AND wm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "meeting_task_reviews_update" ON app_onework.meeting_task_reviews;
CREATE POLICY "meeting_task_reviews_update" ON app_onework.meeting_task_reviews
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM app_onework.call_sessions cs
            JOIN app_onework.workspace_members wm ON wm.workspace_id = cs.workspace_id
            WHERE cs.id = meeting_task_reviews.call_session_id
              AND wm.user_id = auth.uid()
        )
    );

-- Link call recording to Files module row (Meeting-Recording folder). Run on existing DBs.
ALTER TABLE app_onework.call_recordings
    ADD COLUMN IF NOT EXISTS workspace_file_id UUID
        REFERENCES app_onework.workspace_files(id) ON DELETE SET NULL;
