-- workspace_presence: default status online for new rows (logged-in members default to online).
ALTER TABLE app_onework.workspace_presence
    ALTER COLUMN status SET DEFAULT 'online';
