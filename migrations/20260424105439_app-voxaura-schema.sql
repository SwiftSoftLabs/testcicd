create or replace function public.jwt_sub()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '');
$$;

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.create_default_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into app_voxaura.user_profiles (user_id, display_name)
  values (new.id, coalesce(new.name, split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

CREATE TABLE IF NOT EXISTS app_VoxAura.auth_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, email text NOT NULL, "emailVerified" timestamptz, image text, stripe_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS app_VoxAura.auth_accounts (id uuid NOT NULL DEFAULT gen_random_uuid(), "userId" uuid NOT NULL, type text NOT NULL, provider text NOT NULL, "providerAccountId" text NOT NULL, access_token text, expires_at bigint, refresh_token text, id_token text, scope text, session_state text, token_type text, password text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE UNIQUE INDEX "auth_accounts_provider_providerAccountId_key" ON app_VoxAura.auth_accounts USING btree (provider, "providerAccountId");

CREATE INDEX idx_auth_accounts_user_id ON app_VoxAura.auth_accounts USING btree ("userId");

ALTER TABLE app_VoxAura.auth_accounts ADD CONSTRAINT "auth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES app_VoxAura.auth_users (id) ON DELETE CASCADE;

ALTER TABLE app_VoxAura.auth_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_accounts_self_all ON app_VoxAura.auth_accounts FOR ALL TO public USING ((("userId")::text = jwt_sub())) WITH CHECK ((("userId")::text = jwt_sub()));

CREATE POLICY project_admin_policy_auth_accounts ON app_VoxAura.auth_accounts FOR ALL TO project_admin USING (true) WITH CHECK (true);

CREATE TRIGGER trg_auth_accounts_updated_at BEFORE UPDATE ON app_VoxAura.auth_accounts FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE IF NOT EXISTS app_VoxAura.auth_sessions (id uuid NOT NULL DEFAULT gen_random_uuid(), "sessionToken" text NOT NULL, "userId" uuid NOT NULL, expires timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE UNIQUE INDEX "auth_sessions_sessionToken_key" ON app_VoxAura.auth_sessions USING btree ("sessionToken");

CREATE INDEX idx_auth_sessions_token ON app_VoxAura.auth_sessions USING btree ("sessionToken");

CREATE INDEX idx_auth_sessions_user_id ON app_VoxAura.auth_sessions USING btree ("userId");

ALTER TABLE app_VoxAura.auth_sessions ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES app_VoxAura.auth_users (id) ON DELETE CASCADE;

ALTER TABLE app_VoxAura.auth_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_sessions_self_all ON app_VoxAura.auth_sessions FOR ALL TO public USING ((("userId")::text = jwt_sub())) WITH CHECK ((("userId")::text = jwt_sub()));

CREATE POLICY project_admin_policy_auth_sessions ON app_VoxAura.auth_sessions FOR ALL TO project_admin USING (true) WITH CHECK (true);

CREATE TRIGGER trg_auth_sessions_updated_at BEFORE UPDATE ON app_VoxAura.auth_sessions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE IF NOT EXISTS app_VoxAura.auth_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, email text NOT NULL, "emailVerified" timestamptz, image text, stripe_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE UNIQUE INDEX auth_users_email_key ON app_VoxAura.auth_users USING btree (email);

ALTER TABLE app_VoxAura.auth_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_users_self_select ON app_VoxAura.auth_users FOR SELECT TO public USING (((id)::text = jwt_sub()));

CREATE POLICY auth_users_self_update ON app_VoxAura.auth_users FOR UPDATE TO public USING (((id)::text = jwt_sub())) WITH CHECK (((id)::text = jwt_sub()));

CREATE POLICY project_admin_policy_auth_users ON app_VoxAura.auth_users FOR ALL TO project_admin USING (true) WITH CHECK (true);

CREATE TRIGGER trg_auth_users_create_profile AFTER INSERT ON app_VoxAura.auth_users FOR EACH ROW EXECUTE FUNCTION create_default_user_profile();

CREATE TRIGGER trg_auth_users_updated_at BEFORE UPDATE ON app_VoxAura.auth_users FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE IF NOT EXISTS app_VoxAura.auth_verification_token (identifier text NOT NULL, expires timestamptz NOT NULL, token text NOT NULL);

ALTER TABLE app_VoxAura.auth_verification_token ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_verification_token_no_client_access ON app_VoxAura.auth_verification_token FOR ALL TO public USING (false) WITH CHECK (false);

CREATE POLICY project_admin_policy_auth_verification_token ON app_VoxAura.auth_verification_token FOR ALL TO project_admin USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS app_VoxAura.prompts (id uuid NOT NULL DEFAULT gen_random_uuid(), scenario_id text NOT NULL, category text NOT NULL, title text NOT NULL, description text, difficulty integer NOT NULL DEFAULT 1, persona_name text, persona_traits jsonb NOT NULL DEFAULT '[]'::jsonb, system_prompt text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX idx_prompts_category_active ON app_VoxAura.prompts USING btree (category, is_active);

CREATE UNIQUE INDEX prompts_scenario_id_key ON app_VoxAura.prompts USING btree (scenario_id);

ALTER TABLE app_VoxAura.prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_admin_policy_prompts ON app_VoxAura.prompts FOR ALL TO project_admin USING (true) WITH CHECK (true);

CREATE POLICY prompts_no_client_write ON app_VoxAura.prompts FOR ALL TO public USING (false) WITH CHECK (false);

CREATE POLICY prompts_read_authenticated ON app_VoxAura.prompts FOR SELECT TO public USING (((jwt_sub() IS NOT NULL) AND (is_active = true)));

CREATE TRIGGER trg_prompts_updated_at BEFORE UPDATE ON app_VoxAura.prompts FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

INSERT INTO app_VoxAura.prompts (id, scenario_id, category, title, description, difficulty, persona_name, persona_traits, system_prompt, is_active, created_at, updated_at) VALUES ('40dca0fe-0f39-4c6e-bda0-3a11ad03bb96', 'sales-angry-customer-1', 'sales_dojo', 'Late Shipment Escalation', 'Customer is upset about a delayed order and threatens to cancel.', 2, 'Angry Customer', '["impatient","skeptical","interrupts often"]', 'You are an angry customer. You interrupt weak points, challenge vague promises, and ask for concrete resolution.', true, '2026-04-24T09:34:15.650Z', '2026-04-24T09:34:15.650Z');

INSERT INTO app_VoxAura.prompts (id, scenario_id, category, title, description, difficulty, persona_name, persona_traits, system_prompt, is_active, created_at, updated_at) VALUES ('174b0515-fa52-404f-a853-3ca262d35860', 'sales-budget-cfo-1', 'sales_dojo', 'Budget-Constrained CFO', 'CFO questions ROI and pushes back on pricing.', 3, 'Skeptical CFO', '["analytical","cost-focused","risk-averse"]', 'You are a skeptical CFO. Ask concise but hard financial objections and require clear ROI-based answers.', true, '2026-04-24T09:34:15.650Z', '2026-04-24T09:34:15.650Z');

INSERT INTO app_VoxAura.prompts (id, scenario_id, category, title, description, difficulty, persona_name, persona_traits, system_prompt, is_active, created_at, updated_at) VALUES ('258f7bfe-64de-4a5c-89e9-28f0846d36d8', 'accent-th-sounds-1', 'accent_doctor', 'TH Sound Drill', 'Practice clear /th/ pronunciation in common business phrases.', 1, 'Pronunciation Coach', '["precise","supportive","technical"]', 'You are a pronunciation coach focused on clarity and rhythm. Correct gently and ask for repetition.', true, '2026-04-24T09:34:15.650Z', '2026-04-24T09:34:15.650Z');

INSERT INTO app_VoxAura.prompts (id, scenario_id, category, title, description, difficulty, persona_name, persona_traits, system_prompt, is_active, created_at, updated_at) VALUES ('c55a2efd-d53d-49a8-b2d8-6ffa00f6ac0e', 'empathy-deescalation-1', 'empathy_practice', 'Team Conflict De-escalation', 'Handle emotional tension while staying calm and clear.', 2, 'Frustrated Teammate', '["emotional","defensive","needs validation"]', 'You are a frustrated teammate. You want to feel heard before discussing solutions.', true, '2026-04-24T09:34:15.650Z', '2026-04-24T09:34:15.650Z');

CREATE TABLE IF NOT EXISTS app_VoxAura.sessions (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, session_uuid text NOT NULL, mode text NOT NULL, persona_id text, cost_in_tokens integer NOT NULL DEFAULT 0, transcript jsonb NOT NULL DEFAULT '[]'::jsonb, timestamp timestamptz NOT NULL DEFAULT now(), duration_seconds integer, charisma_score integer, wpm_average integer, filler_word_count integer, pitch_variance numeric, uptalk_incidents integer, confidence_avg numeric, anxiety_avg numeric, sentiment_trend jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX idx_sessions_mode ON app_VoxAura.sessions USING btree (mode);

CREATE INDEX idx_sessions_user_timestamp ON app_VoxAura.sessions USING btree (user_id, "timestamp" DESC);

CREATE INDEX idx_sessions_uuid ON app_VoxAura.sessions USING btree (session_uuid);

CREATE UNIQUE INDEX sessions_session_uuid_key ON app_VoxAura.sessions USING btree (session_uuid);

ALTER TABLE app_VoxAura.sessions ADD CONSTRAINT sessions_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES app_VoxAura.prompts (scenario_id) ON DELETE SET NULL;

ALTER TABLE app_VoxAura.sessions ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_VoxAura.auth_users (id) ON DELETE CASCADE;

ALTER TABLE app_VoxAura.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_admin_policy_sessions ON app_VoxAura.sessions FOR ALL TO project_admin USING (true) WITH CHECK (true);

CREATE POLICY sessions_self_all ON app_VoxAura.sessions FOR ALL TO public USING (((user_id)::text = jwt_sub())) WITH CHECK (((user_id)::text = jwt_sub()));

CREATE TRIGGER trg_sessions_updated_at BEFORE UPDATE ON app_VoxAura.sessions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE IF NOT EXISTS app_VoxAura.user_profiles (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, display_name text, avatar_url text, token_balance integer NOT NULL DEFAULT 50, subscription_status text NOT NULL DEFAULT 'free'::text, subscription_renewal_date timestamptz, last_daily_token_grant date, total_sessions integer NOT NULL DEFAULT 0, total_minutes_practiced integer NOT NULL DEFAULT 0, average_charisma_score numeric NOT NULL DEFAULT 0, streak_days integer NOT NULL DEFAULT 0, last_practice_date date, push_notifications_enabled boolean NOT NULL DEFAULT true, practice_reminders_enabled boolean NOT NULL DEFAULT true, sound_effects_enabled boolean NOT NULL DEFAULT true, notification_token text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX idx_user_profiles_user_id ON app_VoxAura.user_profiles USING btree (user_id);

CREATE UNIQUE INDEX user_profiles_user_id_key ON app_VoxAura.user_profiles USING btree (user_id);

ALTER TABLE app_VoxAura.user_profiles ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_VoxAura.auth_users (id) ON DELETE CASCADE;

ALTER TABLE app_VoxAura.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_admin_policy_user_profiles ON app_VoxAura.user_profiles FOR ALL TO project_admin USING (true) WITH CHECK (true);

CREATE POLICY user_profiles_self_all ON app_VoxAura.user_profiles FOR ALL TO public USING (((user_id)::text = jwt_sub())) WITH CHECK (((user_id)::text = jwt_sub()));

CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON app_VoxAura.user_profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
