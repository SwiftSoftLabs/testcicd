-- OneWork: LiveKit columns for call_sessions / participants / recordings
-- Schema: app_onework

ALTER TABLE app_onework.call_sessions
  ADD COLUMN IF NOT EXISTS livekit_room_name TEXT,
  ADD COLUMN IF NOT EXISTS livekit_agent_dispatch_id TEXT;

ALTER TABLE app_onework.call_participants
  ADD COLUMN IF NOT EXISTS livekit_identity TEXT;

ALTER TABLE app_onework.call_recordings
  ADD COLUMN IF NOT EXISTS livekit_egress_id TEXT;

UPDATE app_onework.call_sessions
SET livekit_room_name = agora_channel_name
WHERE livekit_room_name IS NULL AND agora_channel_name IS NOT NULL;
