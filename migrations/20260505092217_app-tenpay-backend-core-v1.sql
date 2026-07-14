DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenpay_user') THEN
    CREATE ROLE app_tenpay_user NOINHERIT;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app_tenpay;

REVOKE ALL ON SCHEMA public FROM app_tenpay_user;

GRANT USAGE, CREATE ON SCHEMA app_tenpay TO app_tenpay_user;

ALTER ROLE app_tenpay_user SET search_path TO app_tenpay;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_tenpay
GRANT ALL PRIVILEGES ON TABLES TO app_tenpay_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_tenpay
GRANT ALL PRIVILEGES ON SEQUENCES TO app_tenpay_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_tenpay
GRANT EXECUTE ON FUNCTIONS TO app_tenpay_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_tenpay TO app_tenpay_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_tenpay TO app_tenpay_user;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_tenpay TO app_tenpay_user;

CREATE OR REPLACE FUNCTION app_tenpay.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT auth.uid()
$$;

CREATE OR REPLACE FUNCTION app_tenpay.is_max_member_safe()
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

CREATE TABLE IF NOT EXISTS app_tenpay.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  full_name text,
  business_name text,
  country_code text,
  base_currency text NOT NULL DEFAULT 'USD',
  home_office_sqft numeric(10,2),
  total_home_sqft numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_app_origin_check CHECK (app_origin = 'app_tenpay')
);

CREATE TABLE IF NOT EXISTS app_tenpay.platform_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_tenpay.profiles(user_id) ON DELETE CASCADE,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'authentication_required',
  provider_account_id text,
  access_token_ref text,
  refresh_token_ref text,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_connections_platform_check CHECK (
    platform IN ('youtube', 'twitch', 'patreon', 'stripe')
  ),
  CONSTRAINT platform_connections_status_check CHECK (
    status IN ('connected', 'syncing', 'authentication_required', 'error')
  ),
  CONSTRAINT platform_connections_app_origin_check CHECK (app_origin = 'app_tenpay'),
  CONSTRAINT platform_connections_unique UNIQUE (user_id, platform, provider_account_id)
);

CREATE TABLE IF NOT EXISTS app_tenpay.income_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_tenpay.profiles(user_id) ON DELETE CASCADE,
  platform_connection_id uuid REFERENCES app_tenpay.platform_connections(id) ON DELETE SET NULL,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  occurred_at timestamptz NOT NULL,
  source_platform text NOT NULL,
  external_transaction_id text,
  description text,
  gross_amount numeric(18,6) NOT NULL,
  platform_fee_amount numeric(18,6) NOT NULL DEFAULT 0,
  net_amount numeric(18,6) NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT income_transactions_source_platform_check CHECK (
    source_platform IN ('youtube', 'twitch', 'patreon', 'stripe', 'other')
  ),
  CONSTRAINT income_transactions_status_check CHECK (
    status IN ('pending', 'cleared', 'failed')
  ),
  CONSTRAINT income_transactions_app_origin_check CHECK (app_origin = 'app_tenpay')
);

CREATE TABLE IF NOT EXISTS app_tenpay.expense_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_tenpay.profiles(user_id) ON DELETE CASCADE,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  occurred_at timestamptz NOT NULL,
  merchant_name text,
  description text,
  amount numeric(18,6) NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  expense_category text,
  ai_suggested_category text,
  is_user_confirmed boolean NOT NULL DEFAULT false,
  tax_treatment jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_transactions_app_origin_check CHECK (app_origin = 'app_tenpay')
);

CREATE TABLE IF NOT EXISTS app_tenpay.contractor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_tenpay.profiles(user_id) ON DELETE CASCADE,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  email text NOT NULL,
  legal_name text,
  tax_country text DEFAULT 'US',
  w9_status text NOT NULL DEFAULT 'missing',
  tin_validation_status text NOT NULL DEFAULT 'unverified',
  w9_document_ref text,
  yearly_paid_amount numeric(18,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contractor_profiles_w9_status_check CHECK (
    w9_status IN ('missing', 'submitted', 'verified', 'rejected')
  ),
  CONSTRAINT contractor_profiles_tin_status_check CHECK (
    tin_validation_status IN ('unverified', 'pending', 'verified', 'failed')
  ),
  CONSTRAINT contractor_profiles_app_origin_check CHECK (app_origin = 'app_tenpay'),
  CONSTRAINT contractor_profiles_owner_email_unique UNIQUE (owner_user_id, email)
);

CREATE TABLE IF NOT EXISTS app_tenpay.collective_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_tenpay.profiles(user_id) ON DELETE CASCADE,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  source_platform text,
  escrow_holding_days integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collective_projects_status_check CHECK (
    status IN ('active', 'archived')
  ),
  CONSTRAINT collective_projects_app_origin_check CHECK (app_origin = 'app_tenpay')
);

CREATE TABLE IF NOT EXISTS app_tenpay.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES app_tenpay.collective_projects(id) ON DELETE CASCADE,
  contractor_id uuid REFERENCES app_tenpay.contractor_profiles(id) ON DELETE SET NULL,
  user_id uuid REFERENCES app_tenpay.profiles(user_id) ON DELETE SET NULL,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  role text NOT NULL DEFAULT 'collaborator',
  email text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_members_role_check CHECK (
    role IN ('owner', 'collaborator', 'manager', 'editor')
  ),
  CONSTRAINT project_members_app_origin_check CHECK (app_origin = 'app_tenpay')
);

CREATE TABLE IF NOT EXISTS app_tenpay.split_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES app_tenpay.collective_projects(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES app_tenpay.project_members(id) ON DELETE CASCADE,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  equity_percent numeric(7,4) NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT split_rules_equity_check CHECK (equity_percent >= 0 AND equity_percent <= 100),
  CONSTRAINT split_rules_app_origin_check CHECK (app_origin = 'app_tenpay')
);

CREATE TABLE IF NOT EXISTS app_tenpay.ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_tenpay.profiles(user_id) ON DELETE CASCADE,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  account_code text NOT NULL,
  account_name text NOT NULL,
  account_type text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_accounts_type_check CHECK (
    account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')
  ),
  CONSTRAINT ledger_accounts_app_origin_check CHECK (app_origin = 'app_tenpay'),
  CONSTRAINT ledger_accounts_owner_code_unique UNIQUE (owner_user_id, account_code)
);

CREATE TABLE IF NOT EXISTS app_tenpay.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_tenpay.profiles(user_id) ON DELETE CASCADE,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  project_id uuid REFERENCES app_tenpay.collective_projects(id) ON DELETE SET NULL,
  source_type text NOT NULL,
  source_id uuid,
  entry_group_id uuid NOT NULL,
  entry_side text NOT NULL,
  account_id uuid NOT NULL REFERENCES app_tenpay.ledger_accounts(id) ON DELETE RESTRICT,
  amount numeric(18,6) NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  occurred_at timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_side_check CHECK (entry_side IN ('debit', 'credit')),
  CONSTRAINT ledger_entries_source_type_check CHECK (
    source_type IN ('income', 'expense', 'split', 'payout', 'adjustment')
  ),
  CONSTRAINT ledger_entries_amount_positive CHECK (amount >= 0),
  CONSTRAINT ledger_entries_app_origin_check CHECK (app_origin = 'app_tenpay')
);

CREATE TABLE IF NOT EXISTS app_tenpay.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_tenpay.profiles(user_id) ON DELETE CASCADE,
  project_id uuid REFERENCES app_tenpay.collective_projects(id) ON DELETE SET NULL,
  member_id uuid REFERENCES app_tenpay.project_members(id) ON DELETE SET NULL,
  contractor_id uuid REFERENCES app_tenpay.contractor_profiles(id) ON DELETE SET NULL,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  amount numeric(18,6) NOT NULL,
  currency_code text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending',
  processor text,
  processor_transfer_id text,
  hold_until timestamptz,
  scheduled_for timestamptz,
  paid_at timestamptz,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payouts_status_check CHECK (
    status IN ('pending', 'blocked', 'scheduled', 'processing', 'paid', 'failed', 'cancelled')
  ),
  CONSTRAINT payouts_app_origin_check CHECK (app_origin = 'app_tenpay')
);

CREATE TABLE IF NOT EXISTS app_tenpay.tax_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_tenpay.profiles(user_id) ON DELETE CASCADE,
  contractor_id uuid REFERENCES app_tenpay.contractor_profiles(id) ON DELETE SET NULL,
  app_origin text NOT NULL DEFAULT 'app_tenpay',
  tax_year integer NOT NULL,
  document_type text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  storage_ref text,
  efile_submission_id text,
  delivered_at timestamptz,
  filed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_documents_type_check CHECK (
    document_type IN ('w9', '1099-nec', '1099-misc')
  ),
  CONSTRAINT tax_documents_status_check CHECK (
    status IN ('draft', 'pending_review', 'ready_to_file', 'filed', 'rejected')
  ),
  CONSTRAINT tax_documents_app_origin_check CHECK (app_origin = 'app_tenpay')
);

CREATE INDEX IF NOT EXISTS idx_income_transactions_user_occurred_at
  ON app_tenpay.income_transactions (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_expense_transactions_user_occurred_at
  ON app_tenpay.expense_transactions (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_owner_group
  ON app_tenpay.ledger_entries (owner_user_id, entry_group_id);

CREATE INDEX IF NOT EXISTS idx_payouts_owner_status
  ON app_tenpay.payouts (owner_user_id, status);

CREATE OR REPLACE FUNCTION app_tenpay.has_project_access(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app_tenpay.collective_projects p
    WHERE p.id = p_project_id
      AND (
        p.owner_user_id = app_tenpay.current_user_id()
        OR app_tenpay.is_max_member_safe()
        OR EXISTS (
          SELECT 1
          FROM app_tenpay.project_members pm
          WHERE pm.project_id = p.id
            AND pm.user_id = app_tenpay.current_user_id()
            AND pm.is_active = true
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION app_tenpay.enforce_1099_compliance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_w9_status text;
  v_yearly_paid numeric(18,6);
BEGIN
  IF NEW.contractor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.w9_status, c.yearly_paid_amount
  INTO v_w9_status, v_yearly_paid
  FROM app_tenpay.contractor_profiles c
  WHERE c.id = NEW.contractor_id;

  IF COALESCE(v_yearly_paid, 0) >= 600 AND COALESCE(v_w9_status, 'missing') <> 'verified' THEN
    NEW.status := 'blocked';
    NEW.failure_reason := COALESCE(NEW.failure_reason, 'Blocked: W-9 required for payouts >= $600');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_1099_compliance ON app_tenpay.payouts;

CREATE TRIGGER trg_enforce_1099_compliance
BEFORE INSERT OR UPDATE ON app_tenpay.payouts
FOR EACH ROW
EXECUTE FUNCTION app_tenpay.enforce_1099_compliance();

ALTER TABLE app_tenpay.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_tenpay.platform_connections ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_tenpay.income_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_tenpay.expense_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_tenpay.contractor_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_tenpay.collective_projects ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_tenpay.project_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_tenpay.split_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_tenpay.ledger_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_tenpay.ledger_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_tenpay.payouts ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_tenpay.tax_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_rw ON app_tenpay.profiles;

CREATE POLICY profiles_rw ON app_tenpay.profiles
FOR ALL TO authenticated
USING (user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe())
WITH CHECK (user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe());

DROP POLICY IF EXISTS platform_connections_rw ON app_tenpay.platform_connections;

CREATE POLICY platform_connections_rw ON app_tenpay.platform_connections
FOR ALL TO authenticated
USING (user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe())
WITH CHECK (user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe());

DROP POLICY IF EXISTS income_transactions_rw ON app_tenpay.income_transactions;

CREATE POLICY income_transactions_rw ON app_tenpay.income_transactions
FOR ALL TO authenticated
USING (user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe())
WITH CHECK (user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe());

DROP POLICY IF EXISTS expense_transactions_rw ON app_tenpay.expense_transactions;

CREATE POLICY expense_transactions_rw ON app_tenpay.expense_transactions
FOR ALL TO authenticated
USING (user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe())
WITH CHECK (user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe());

DROP POLICY IF EXISTS contractor_profiles_rw ON app_tenpay.contractor_profiles;

CREATE POLICY contractor_profiles_rw ON app_tenpay.contractor_profiles
FOR ALL TO authenticated
USING (owner_user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe())
WITH CHECK (owner_user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe());

DROP POLICY IF EXISTS collective_projects_rw ON app_tenpay.collective_projects;

CREATE POLICY collective_projects_rw ON app_tenpay.collective_projects
FOR ALL TO authenticated
USING (
  owner_user_id = app_tenpay.current_user_id()
  OR app_tenpay.is_max_member_safe()
  OR app_tenpay.has_project_access(id)
)
WITH CHECK (
  owner_user_id = app_tenpay.current_user_id()
  OR app_tenpay.is_max_member_safe()
);

DROP POLICY IF EXISTS project_members_rw ON app_tenpay.project_members;

CREATE POLICY project_members_rw ON app_tenpay.project_members
FOR ALL TO authenticated
USING (app_tenpay.has_project_access(project_id) OR app_tenpay.is_max_member_safe())
WITH CHECK (app_tenpay.has_project_access(project_id) OR app_tenpay.is_max_member_safe());

DROP POLICY IF EXISTS split_rules_rw ON app_tenpay.split_rules;

CREATE POLICY split_rules_rw ON app_tenpay.split_rules
FOR ALL TO authenticated
USING (app_tenpay.has_project_access(project_id) OR app_tenpay.is_max_member_safe())
WITH CHECK (app_tenpay.has_project_access(project_id) OR app_tenpay.is_max_member_safe());

DROP POLICY IF EXISTS ledger_accounts_rw ON app_tenpay.ledger_accounts;

CREATE POLICY ledger_accounts_rw ON app_tenpay.ledger_accounts
FOR ALL TO authenticated
USING (owner_user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe())
WITH CHECK (owner_user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe());

DROP POLICY IF EXISTS ledger_entries_rw ON app_tenpay.ledger_entries;

CREATE POLICY ledger_entries_rw ON app_tenpay.ledger_entries
FOR ALL TO authenticated
USING (owner_user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe())
WITH CHECK (owner_user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe());

DROP POLICY IF EXISTS payouts_rw ON app_tenpay.payouts;

CREATE POLICY payouts_rw ON app_tenpay.payouts
FOR ALL TO authenticated
USING (owner_user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe())
WITH CHECK (owner_user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe());

DROP POLICY IF EXISTS tax_documents_rw ON app_tenpay.tax_documents;

CREATE POLICY tax_documents_rw ON app_tenpay.tax_documents
FOR ALL TO authenticated
USING (owner_user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe())
WITH CHECK (owner_user_id = app_tenpay.current_user_id() OR app_tenpay.is_max_member_safe());
