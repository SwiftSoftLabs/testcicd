CREATE SCHEMA IF NOT EXISTS app_spamrescue;

SET search_path TO app_spamrescue, public;

CREATE TABLE IF NOT EXISTS app_spamrescue.connected_accounts (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, provider text NOT NULL, email_address text NOT NULL, refresh_token text, access_token text, last_scan_timestamp timestamptz DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());

CREATE UNIQUE INDEX connected_accounts_user_id_email_address_key ON app_spamrescue.connected_accounts USING btree (user_id, email_address);

ALTER TABLE app_spamrescue.connected_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_delete_own ON app_spamrescue.connected_accounts;

CREATE POLICY accounts_delete_own ON app_spamrescue.connected_accounts FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS accounts_insert_own ON app_spamrescue.connected_accounts;

CREATE POLICY accounts_insert_own ON app_spamrescue.connected_accounts FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS accounts_select_own ON app_spamrescue.connected_accounts;

CREATE POLICY accounts_select_own ON app_spamrescue.connected_accounts FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS accounts_update_own ON app_spamrescue.connected_accounts;

CREATE POLICY accounts_update_own ON app_spamrescue.connected_accounts FOR UPDATE TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS project_admin_policy ON app_spamrescue.connected_accounts;

CREATE POLICY project_admin_policy ON app_spamrescue.connected_accounts FOR ALL TO project_admin USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS app_spamrescue.contact_messages (id uuid NOT NULL DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE app_spamrescue.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_insert_public ON app_spamrescue.contact_messages;

CREATE POLICY contact_insert_public ON app_spamrescue.contact_messages FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS project_admin_policy ON app_spamrescue.contact_messages;

CREATE POLICY project_admin_policy ON app_spamrescue.contact_messages FOR ALL TO project_admin USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS app_spamrescue.profiles (id uuid NOT NULL, full_name text, avatar_url text, phone_number text, sms_enabled boolean NOT NULL DEFAULT false, subscription_tier text NOT NULL DEFAULT 'starter'::text, subscription_status text NOT NULL DEFAULT 'inactive'::text, subscription_end_date timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE app_spamrescue.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_insert_own ON app_spamrescue.profiles;

CREATE POLICY profiles_insert_own ON app_spamrescue.profiles FOR INSERT TO public WITH CHECK ((auth.uid() = id));

DROP POLICY IF EXISTS profiles_select_own ON app_spamrescue.profiles;

CREATE POLICY profiles_select_own ON app_spamrescue.profiles FOR SELECT TO public USING ((auth.uid() = id));

DROP POLICY IF EXISTS profiles_update_own ON app_spamrescue.profiles;

CREATE POLICY profiles_update_own ON app_spamrescue.profiles FOR UPDATE TO public USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));

DROP POLICY IF EXISTS project_admin_policy ON app_spamrescue.profiles;

CREATE POLICY project_admin_policy ON app_spamrescue.profiles FOR ALL TO project_admin USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS app_spamrescue.rescued_emails (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, external_email_id text, sender_address text NOT NULL, subject text NOT NULL, snippet text, received_at timestamptz NOT NULL DEFAULT now(), rescued_at timestamptz, ai_confidence numeric, ai_reasoning text, status text NOT NULL DEFAULT 'pending'::text, estimated_value numeric, urgency text, suggested_reply text, created_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX rescued_emails_user_status_idx ON app_spamrescue.rescued_emails USING btree (user_id, status, received_at DESC);

ALTER TABLE app_spamrescue.rescued_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emails_delete_own ON app_spamrescue.rescued_emails;

CREATE POLICY emails_delete_own ON app_spamrescue.rescued_emails FOR DELETE TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS emails_insert_own ON app_spamrescue.rescued_emails;

CREATE POLICY emails_insert_own ON app_spamrescue.rescued_emails FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS emails_select_own ON app_spamrescue.rescued_emails;

CREATE POLICY emails_select_own ON app_spamrescue.rescued_emails FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS emails_update_own ON app_spamrescue.rescued_emails;

CREATE POLICY emails_update_own ON app_spamrescue.rescued_emails FOR UPDATE TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS project_admin_policy ON app_spamrescue.rescued_emails;

CREATE POLICY project_admin_policy ON app_spamrescue.rescued_emails FOR ALL TO project_admin USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS app_spamrescue.user_settings (user_id uuid NOT NULL, sensitivity integer NOT NULL DEFAULT 50, keywords text NOT NULL DEFAULT ''::text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE app_spamrescue.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_admin_policy ON app_spamrescue.user_settings;

CREATE POLICY project_admin_policy ON app_spamrescue.user_settings FOR ALL TO project_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS settings_insert_own ON app_spamrescue.user_settings;

CREATE POLICY settings_insert_own ON app_spamrescue.user_settings FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));

DROP POLICY IF EXISTS settings_select_own ON app_spamrescue.user_settings;

CREATE POLICY settings_select_own ON app_spamrescue.user_settings FOR SELECT TO public USING ((auth.uid() = user_id));

DROP POLICY IF EXISTS settings_update_own ON app_spamrescue.user_settings;

CREATE POLICY settings_update_own ON app_spamrescue.user_settings FOR UPDATE TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
