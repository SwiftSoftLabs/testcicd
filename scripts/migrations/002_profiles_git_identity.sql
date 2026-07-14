-- Optional Git commit identity (separate from display name / login email)
ALTER TABLE app_onework.profiles
  ADD COLUMN IF NOT EXISTS git_name TEXT,
  ADD COLUMN IF NOT EXISTS git_email TEXT;
