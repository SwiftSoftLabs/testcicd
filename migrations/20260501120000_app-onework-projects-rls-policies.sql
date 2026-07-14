DROP POLICY IF EXISTS "Projects are viewable by workspace members" ON app_onework.projects;

CREATE POLICY "Projects are viewable by workspace members"
  ON app_onework.projects FOR SELECT
  USING (
    public.onework_is_workspace_member(workspace_id)
    OR public.is_max_member()
  );

DROP POLICY IF EXISTS "Projects can be created by workspace members" ON app_onework.projects;

CREATE POLICY "Projects can be created by workspace members"
  ON app_onework.projects FOR INSERT
  WITH CHECK (
    public.onework_is_workspace_member(workspace_id)
    OR public.is_max_member()
  );

DROP POLICY IF EXISTS "Projects can be updated by workspace members" ON app_onework.projects;

CREATE POLICY "Projects can be updated by workspace members"
  ON app_onework.projects FOR UPDATE
  USING (
    public.onework_is_workspace_member(workspace_id)
    OR public.is_max_member()
  );

DROP POLICY IF EXISTS "Projects can be deleted by workspace members" ON app_onework.projects;

CREATE POLICY "Projects can be deleted by workspace members"
  ON app_onework.projects FOR DELETE
  USING (
    public.onework_is_workspace_member(workspace_id)
    OR public.is_max_member()
  );
