DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_coderunner_user') THEN
    CREATE ROLE app_coderunner_user NOINHERIT;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app_coderunner;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

REVOKE ALL ON SCHEMA public FROM app_coderunner_user;

GRANT USAGE, CREATE ON SCHEMA app_coderunner TO app_coderunner_user;

ALTER ROLE app_coderunner_user SET search_path TO app_coderunner;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_coderunner
GRANT ALL PRIVILEGES ON TABLES TO app_coderunner_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_coderunner
GRANT ALL PRIVILEGES ON SEQUENCES TO app_coderunner_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_coderunner
GRANT EXECUTE ON FUNCTIONS TO app_coderunner_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_coderunner TO app_coderunner_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_coderunner TO app_coderunner_user;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_coderunner TO app_coderunner_user;

CREATE OR REPLACE FUNCTION app_coderunner.is_max_member_safe()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  has_helper boolean;
  result boolean;
BEGIN
  SELECT to_regprocedure('public.is_max_member()') IS NOT NULL INTO has_helper;
  IF NOT has_helper THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT public.is_max_member()' INTO result;
  RETURN COALESCE(result, false);
END;
$$;

CREATE TABLE IF NOT EXISTS app_coderunner.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  app_origin text NOT NULL DEFAULT 'app_coderunner',
  display_name text,
  handle text UNIQUE,
  avatar_initials text,
  pro_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_app_origin_check CHECK (app_origin = 'app_coderunner')
);

CREATE TABLE IF NOT EXISTS app_coderunner.challenges (
  id text PRIMARY KEY,
  app_origin text NOT NULL DEFAULT 'app_coderunner',
  title text NOT NULL,
  description text NOT NULL,
  verification text NOT NULL,
  record_ms integer NOT NULL CHECK (record_ms >= 0),
  average_ms integer NOT NULL CHECK (average_ms >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  accent text NOT NULL DEFAULT 'emerald',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenges_app_origin_check CHECK (app_origin = 'app_coderunner')
);

CREATE TABLE IF NOT EXISTS app_coderunner.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  app_origin text NOT NULL DEFAULT 'app_coderunner',
  challenge_id text NOT NULL REFERENCES app_coderunner.challenges(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES app_coderunner.profiles(user_id) ON DELETE SET NULL,
  developer_name text NOT NULL DEFAULT 'Guest Runner',
  avatar_initials text NOT NULL DEFAULT 'GR',
  elapsed_ms integer CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
  model_chain text NOT NULL DEFAULT 'Unspecified',
  prompt_count integer NOT NULL DEFAULT 0 CHECK (prompt_count >= 0),
  cost_usd numeric(10, 4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  status text NOT NULL DEFAULT 'review',
  replay_public boolean NOT NULL DEFAULT true,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runs_status_check CHECK (status IN ('draft', 'running', 'verified', 'review', 'flagged')),
  CONSTRAINT runs_app_origin_check CHECK (app_origin = 'app_coderunner')
);

CREATE TABLE IF NOT EXISTS app_coderunner.prompt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_origin text NOT NULL DEFAULT 'app_coderunner',
  run_id uuid NOT NULL REFERENCES app_coderunner.runs(id) ON DELETE CASCADE,
  at_ms integer NOT NULL CHECK (at_ms >= 0),
  title text NOT NULL,
  prompt text NOT NULL,
  mutation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_events_app_origin_check CHECK (app_origin = 'app_coderunner')
);

CREATE TABLE IF NOT EXISTS app_coderunner.replay_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_origin text NOT NULL DEFAULT 'app_coderunner',
  run_id uuid NOT NULL REFERENCES app_coderunner.runs(id) ON DELETE CASCADE,
  event_index integer NOT NULL CHECK (event_index >= 0),
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT replay_events_app_origin_check CHECK (app_origin = 'app_coderunner'),
  CONSTRAINT replay_events_run_index_unique UNIQUE (run_id, event_index)
);

CREATE TABLE IF NOT EXISTS app_coderunner.verification_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_origin text NOT NULL DEFAULT 'app_coderunner',
  run_id uuid NOT NULL REFERENCES app_coderunner.runs(id) ON DELETE CASCADE,
  verifier text NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  score numeric(6, 2),
  findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_results_app_origin_check CHECK (app_origin = 'app_coderunner')
);

CREATE INDEX IF NOT EXISTS idx_coderunner_runs_challenge_time
  ON app_coderunner.runs (challenge_id, elapsed_ms ASC)
  WHERE elapsed_ms IS NOT NULL AND replay_public = true;

CREATE INDEX IF NOT EXISTS idx_coderunner_runs_period
  ON app_coderunner.runs (submitted_at DESC)
  WHERE submitted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coderunner_prompt_events_run_time
  ON app_coderunner.prompt_events (run_id, at_ms ASC);

CREATE INDEX IF NOT EXISTS idx_coderunner_replay_events_run_index
  ON app_coderunner.replay_events (run_id, event_index ASC);

ALTER TABLE app_coderunner.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_coderunner.challenges ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_coderunner.runs ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_coderunner.prompt_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_coderunner.replay_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_coderunner.verification_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_owner_or_max ON app_coderunner.profiles;

CREATE POLICY profiles_owner_or_max ON app_coderunner.profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR app_coderunner.is_max_member_safe())
  WITH CHECK (user_id = auth.uid() OR app_coderunner.is_max_member_safe());

DROP POLICY IF EXISTS challenges_public_read ON app_coderunner.challenges;

CREATE POLICY challenges_public_read ON app_coderunner.challenges
  FOR SELECT TO public
  USING (is_active = true);

DROP POLICY IF EXISTS challenges_max_write ON app_coderunner.challenges;

CREATE POLICY challenges_max_write ON app_coderunner.challenges
  FOR ALL TO authenticated
  USING (app_coderunner.is_max_member_safe())
  WITH CHECK (app_coderunner.is_max_member_safe());

DROP POLICY IF EXISTS runs_public_read ON app_coderunner.runs;

CREATE POLICY runs_public_read ON app_coderunner.runs
  FOR SELECT TO public
  USING (replay_public = true AND status IN ('verified', 'review'));

DROP POLICY IF EXISTS runs_owner_or_max_write ON app_coderunner.runs;

CREATE POLICY runs_owner_or_max_write ON app_coderunner.runs
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR app_coderunner.is_max_member_safe())
  WITH CHECK (user_id = auth.uid() OR app_coderunner.is_max_member_safe());

DROP POLICY IF EXISTS prompt_events_public_read ON app_coderunner.prompt_events;

CREATE POLICY prompt_events_public_read ON app_coderunner.prompt_events
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1
      FROM app_coderunner.runs r
      WHERE r.id = run_id
        AND r.replay_public = true
        AND r.status IN ('verified', 'review')
    )
  );

DROP POLICY IF EXISTS prompt_events_owner_or_max_write ON app_coderunner.prompt_events;

CREATE POLICY prompt_events_owner_or_max_write ON app_coderunner.prompt_events
  FOR ALL TO authenticated
  USING (
    app_coderunner.is_max_member_safe()
    OR EXISTS (
      SELECT 1 FROM app_coderunner.runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  )
  WITH CHECK (
    app_coderunner.is_max_member_safe()
    OR EXISTS (
      SELECT 1 FROM app_coderunner.runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS replay_events_public_read ON app_coderunner.replay_events;

CREATE POLICY replay_events_public_read ON app_coderunner.replay_events
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1
      FROM app_coderunner.runs r
      WHERE r.id = run_id
        AND r.replay_public = true
        AND r.status IN ('verified', 'review')
    )
  );

DROP POLICY IF EXISTS replay_events_owner_or_max_write ON app_coderunner.replay_events;

CREATE POLICY replay_events_owner_or_max_write ON app_coderunner.replay_events
  FOR ALL TO authenticated
  USING (
    app_coderunner.is_max_member_safe()
    OR EXISTS (
      SELECT 1 FROM app_coderunner.runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  )
  WITH CHECK (
    app_coderunner.is_max_member_safe()
    OR EXISTS (
      SELECT 1 FROM app_coderunner.runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS verification_results_public_read ON app_coderunner.verification_results;

CREATE POLICY verification_results_public_read ON app_coderunner.verification_results
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1
      FROM app_coderunner.runs r
      WHERE r.id = run_id
        AND r.replay_public = true
        AND r.status IN ('verified', 'review')
    )
  );

DROP POLICY IF EXISTS verification_results_max_write ON app_coderunner.verification_results;

CREATE POLICY verification_results_max_write ON app_coderunner.verification_results
  FOR ALL TO authenticated
  USING (app_coderunner.is_max_member_safe())
  WITH CHECK (app_coderunner.is_max_member_safe());

INSERT INTO app_coderunner.challenges (
  id, title, description, verification, record_ms, average_ms, attempts, accent, sort_order
) VALUES
  (
    'calculator',
    'Working Calculator',
    'Build a precise calculator with precedence, decimals, and graceful division-by-zero handling.',
    'Playwright input matrix plus math edge cases',
    42187,
    287402,
    8421,
    'emerald',
    1
  ),
  (
    'todo-auth',
    'Todo App with Auth',
    'Ship registration, protected routes, and persistent CRUD for a user-scoped todo app.',
    'Auth flow, protected data, and persistence checks',
    151903,
    614221,
    5120,
    'cyan',
    2
  ),
  (
    'pdf-analyzer',
    'PDF Analyzer',
    'Extract invoice numbers, totals, and line items from a standardized multi-page PDF.',
    'Ground-truth extraction against reference fixtures',
    238778,
    790114,
    2198,
    'amber',
    3
  ),
  (
    'landing-page',
    'Landing Page that Converts',
    'Create a high-performing, accessible landing page with conversion elements above the fold.',
    'Lighthouse performance, WCAG, and visual placement audits',
    92384,
    364827,
    6750,
    'rose',
    4
  ),
  (
    'chatbot',
    'Chatbot',
    'Implement a multi-turn assistant that remembers context and handles out-of-scope queries.',
    'Judge-model behavioral tests with 20s response timeout',
    199544,
    702319,
    3344,
    'violet',
    5
  )
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  verification = EXCLUDED.verification,
  record_ms = EXCLUDED.record_ms,
  average_ms = EXCLUDED.average_ms,
  attempts = EXCLUDED.attempts,
  accent = EXCLUDED.accent,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO app_coderunner.runs (
  id, public_id, challenge_id, developer_name, avatar_initials, elapsed_ms, model_chain, prompt_count, cost_usd, status, replay_public, started_at, submitted_at
) VALUES
  ('00000000-0000-4000-8000-000000000001', 'run_wr_8f3', 'calculator', 'Maya Shell', 'MS', 42187, 'Claude 4 -> GPT-4o', 4, 0.38, 'verified', true, '2026-05-08T14:20:17Z', '2026-05-08T14:21:00Z'),
  ('00000000-0000-4000-8000-000000000002', 'run_wr_6c1', 'landing-page', 'Eli Trace', 'ET', 92384, 'Gemini 3.1 Pro -> Claude 4', 6, 0.71, 'verified', true, '2026-05-09T11:03:27Z', '2026-05-09T11:05:00Z'),
  ('00000000-0000-4000-8000-000000000003', 'run_wr_5b9', 'todo-auth', 'Noor Delta', 'ND', 151903, 'GPT-4o -> Claude 4', 9, 1.04, 'review', true, '2026-05-09T21:33:28Z', '2026-05-09T21:36:00Z'),
  ('00000000-0000-4000-8000-000000000004', 'run_wr_4a2', 'chatbot', 'Sana Fork', 'SF', 199544, 'Claude 4', 7, 0.83, 'verified', true, '2026-05-07T17:06:40Z', '2026-05-07T17:10:00Z'),
  ('00000000-0000-4000-8000-000000000005', 'run_wr_32e', 'pdf-analyzer', 'Jon Cache', 'JC', 238778, 'Gemini 3.1 Pro', 11, 1.62, 'verified', true, '2026-05-06T09:38:01Z', '2026-05-06T09:42:00Z')
ON CONFLICT (public_id) DO UPDATE SET
  challenge_id = EXCLUDED.challenge_id,
  developer_name = EXCLUDED.developer_name,
  avatar_initials = EXCLUDED.avatar_initials,
  elapsed_ms = EXCLUDED.elapsed_ms,
  model_chain = EXCLUDED.model_chain,
  prompt_count = EXCLUDED.prompt_count,
  cost_usd = EXCLUDED.cost_usd,
  status = EXCLUDED.status,
  replay_public = EXCLUDED.replay_public,
  started_at = EXCLUDED.started_at,
  submitted_at = EXCLUDED.submitted_at,
  updated_at = now();

INSERT INTO app_coderunner.prompt_events (
  run_id, at_ms, title, prompt, mutation
) VALUES
  ('00000000-0000-4000-8000-000000000001', 0, 'Base Build', 'Create a Next.js calculator with a keyboard-friendly layout, precedence-safe parser, and focused tests.', 'Generated app shell, calculator state, and parser utility.'),
  ('00000000-0000-4000-8000-000000000001', 11840, 'Edge Cases', 'Add decimal precision handling and make division by zero display an explicit recoverable error.', 'Patched evaluator and added validation states in the display.'),
  ('00000000-0000-4000-8000-000000000001', 26120, 'Verification', 'Run the Playwright matrix, fix failing precedence assertions, and keep the UI stable on mobile.', 'Adjusted tokenization and resized keypad tracks.'),
  ('00000000-0000-4000-8000-000000000001', 38990, 'Submit', 'Prepare final submission with no debug UI and confirm all smoke tests pass.', 'Cleaned console output and submitted verified build artifact.')
ON CONFLICT DO NOTHING;

INSERT INTO app_coderunner.verification_results (
  run_id, verifier, passed, score, findings
) VALUES
  ('00000000-0000-4000-8000-000000000001', 'calculator-playwright-matrix', true, 100, '{"passed": 18, "failed": 0}'::jsonb),
  ('00000000-0000-4000-8000-000000000002', 'lighthouse-wcag-audit', true, 96, '{"performance": 96, "accessibility": 100, "seo": 99}'::jsonb),
  ('00000000-0000-4000-8000-000000000003', 'auth-crud-persistence', true, 94, '{"manualReview": true}'::jsonb),
  ('00000000-0000-4000-8000-000000000004', 'judge-model-behavioral', true, 91, '{"timeoutSeconds": 20}'::jsonb),
  ('00000000-0000-4000-8000-000000000005', 'pdf-ground-truth-extraction', true, 98, '{"sample": "invoice-standard-v1"}'::jsonb)
ON CONFLICT DO NOTHING;
