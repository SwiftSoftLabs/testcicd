-- OneWork: Drop Agora columns after LiveKit cutover (run only after backup window)
-- Schema: app_onework

ALTER TABLE app_onework.call_sessions
  DROP COLUMN IF EXISTS agora_channel_name,
  DROP COLUMN IF EXISTS agora_agent_id;

ALTER TABLE app_onework.call_participants
  DROP COLUMN IF EXISTS agora_uid;

ALTER TABLE app_onework.call_recordings
  DROP COLUMN IF EXISTS agora_resource_id,
  DROP COLUMN IF EXISTS agora_sid;
