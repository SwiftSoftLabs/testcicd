-- Recurring calendar events: occurrences are materialized one row per event,
-- linked by a shared series_id, mirroring the Calls recurrence pattern.
-- Run against the existing SwiftSoftLabs InsForge project. Do not create a new project/database.
-- All columns are nullable/additive so existing rows and code paths are unaffected.

ALTER TABLE app_onework.events
  ADD COLUMN IF NOT EXISTS series_id UUID,
  ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT
    CHECK (recurrence_frequency IN ('daily', 'weekdays', 'weekends', 'weekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS recurrence_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS events_series_id_idx
  ON app_onework.events (series_id) WHERE series_id IS NOT NULL;
