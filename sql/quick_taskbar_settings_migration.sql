ALTER TABLE app_onework.workspace_user_settings
  ADD COLUMN IF NOT EXISTS quick_taskbar_pinned BOOLEAN NOT NULL DEFAULT TRUE;
