DROP POLICY IF EXISTS "wm_read" ON app_onework.workspace_members;

DROP POLICY IF EXISTS "Workspace owners can view members." ON app_onework.workspace_members;

DROP POLICY IF EXISTS "workspaces_read" ON app_onework.workspaces;
