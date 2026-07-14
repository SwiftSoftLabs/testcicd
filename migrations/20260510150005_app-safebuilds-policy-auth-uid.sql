DROP POLICY IF EXISTS safebuilds_profiles_self ON app_safebuilds.user_profiles;

CREATE POLICY safebuilds_profiles_self ON app_safebuilds.user_profiles
  FOR ALL
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS safebuilds_templates_owner ON app_safebuilds.form_templates;

CREATE POLICY safebuilds_templates_owner ON app_safebuilds.form_templates
  FOR ALL
  USING      (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS safebuilds_submissions_owner ON app_safebuilds.form_submissions;

CREATE POLICY safebuilds_submissions_owner ON app_safebuilds.form_submissions
  FOR ALL
  USING      (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS safebuilds_audit_read_self   ON app_safebuilds.audit_logs;

DROP POLICY IF EXISTS safebuilds_audit_insert_self ON app_safebuilds.audit_logs;

CREATE POLICY safebuilds_audit_read_self ON app_safebuilds.audit_logs
  FOR SELECT
  USING (actor_id = auth.uid());

CREATE POLICY safebuilds_audit_insert_self ON app_safebuilds.audit_logs
  FOR INSERT
  WITH CHECK (actor_id = auth.uid());
