CREATE OR REPLACE FUNCTION public.onework_is_workspace_member(check_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, app_onework
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_onework.workspace_members
    WHERE workspace_id = check_workspace_id
    AND user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "Workspaces are viewable by members." ON app_onework.workspaces;

CREATE POLICY "Workspaces are viewable by members."
  ON app_onework.workspaces FOR SELECT
  USING (
    owner_id = auth.uid()
    OR public.onework_is_workspace_member(id)
  );

DROP POLICY IF EXISTS "Members can view teammates." ON app_onework.workspace_members;

CREATE POLICY "Members can view teammates."
  ON app_onework.workspace_members FOR SELECT
  USING (
    public.onework_is_workspace_member(workspace_id)
  );
