CREATE SCHEMA IF NOT EXISTS app_exitly;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_exitly_user') THEN
    CREATE ROLE app_exitly_user NOINHERIT;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_exitly_user;

GRANT USAGE, CREATE ON SCHEMA app_exitly TO app_exitly_user;

ALTER ROLE app_exitly_user SET search_path TO app_exitly;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_exitly.profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  app_origin TEXT NOT NULL DEFAULT 'app_exitly',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_exitly.businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  legal_structure TEXT NOT NULL,
  industry_code TEXT,
  base_multiple NUMERIC(8, 3) NOT NULL DEFAULT 3.000,
  valuation_metric TEXT NOT NULL DEFAULT 'sde'
    CHECK (valuation_metric IN ('sde', 'ebitda')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_exitly.accounting_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES app_exitly.businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'rutter',
  external_connection_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'syncing', 'failed', 'disconnected')),
  last_synced_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, external_connection_id)
);

CREATE TABLE IF NOT EXISTS app_exitly.gl_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES app_exitly.businesses(id) ON DELETE CASCADE,
  external_txn_id TEXT NOT NULL,
  txn_date DATE NOT NULL,
  customer_external_id TEXT,
  customer_name TEXT,
  revenue_stream TEXT,
  amount NUMERIC(14, 2) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, external_txn_id)
);

CREATE TABLE IF NOT EXISTS app_exitly.recast_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES app_exitly.businesses(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_exitly.owner_dependency_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES app_exitly.businesses(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score_percent NUMERIC(5, 2) NOT NULL CHECK (score_percent >= 0 AND score_percent <= 100),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_exitly.valuation_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES app_exitly.businesses(id) ON DELETE CASCADE,
  normalized_earnings NUMERIC(14, 2) NOT NULL,
  hhi_score NUMERIC(12, 2) NOT NULL,
  odi_score NUMERIC(5, 2) NOT NULL,
  recurring_revenue_ratio NUMERIC(5, 2) NOT NULL,
  applied_multiple NUMERIC(8, 3) NOT NULL,
  enterprise_value NUMERIC(16, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION app_exitly.is_max_member()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  BEGIN
    RETURN public.is_max_member();
  EXCEPTION WHEN undefined_function THEN
    RETURN FALSE;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION app_exitly.can_access_business(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT app_exitly.is_max_member()
    OR EXISTS (
      SELECT 1 FROM app_exitly.businesses b
      WHERE b.id = p_business_id AND b.owner_user_id = auth.uid()
    );
$$;

ALTER TABLE app_exitly.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_exitly.businesses ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_exitly.accounting_connections ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_exitly.gl_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_exitly.recast_adjustments ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_exitly.owner_dependency_assessments ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_exitly.valuation_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON app_exitly.profiles;

CREATE POLICY profiles_select ON app_exitly.profiles FOR SELECT TO authenticated
  USING (app_exitly.is_max_member() OR user_id = auth.uid());

DROP POLICY IF EXISTS profiles_write ON app_exitly.profiles;

CREATE POLICY profiles_write ON app_exitly.profiles FOR ALL TO authenticated
  USING (app_exitly.is_max_member() OR user_id = auth.uid())
  WITH CHECK (app_exitly.is_max_member() OR user_id = auth.uid());

DROP POLICY IF EXISTS businesses_crud ON app_exitly.businesses;

CREATE POLICY businesses_crud ON app_exitly.businesses FOR ALL TO authenticated
  USING (app_exitly.is_max_member() OR owner_user_id = auth.uid())
  WITH CHECK (app_exitly.is_max_member() OR owner_user_id = auth.uid());

DROP POLICY IF EXISTS accounting_connections_crud ON app_exitly.accounting_connections;

CREATE POLICY accounting_connections_crud ON app_exitly.accounting_connections FOR ALL TO authenticated
  USING (app_exitly.can_access_business(business_id))
  WITH CHECK (app_exitly.can_access_business(business_id));

DROP POLICY IF EXISTS gl_transactions_crud ON app_exitly.gl_transactions;

CREATE POLICY gl_transactions_crud ON app_exitly.gl_transactions FOR ALL TO authenticated
  USING (app_exitly.can_access_business(business_id))
  WITH CHECK (app_exitly.can_access_business(business_id));

DROP POLICY IF EXISTS recast_adjustments_crud ON app_exitly.recast_adjustments;

CREATE POLICY recast_adjustments_crud ON app_exitly.recast_adjustments FOR ALL TO authenticated
  USING (app_exitly.can_access_business(business_id))
  WITH CHECK (app_exitly.can_access_business(business_id));

DROP POLICY IF EXISTS owner_dependency_crud ON app_exitly.owner_dependency_assessments;

CREATE POLICY owner_dependency_crud ON app_exitly.owner_dependency_assessments FOR ALL TO authenticated
  USING (app_exitly.can_access_business(business_id))
  WITH CHECK (app_exitly.can_access_business(business_id));

DROP POLICY IF EXISTS valuation_snapshots_crud ON app_exitly.valuation_snapshots;

CREATE POLICY valuation_snapshots_crud ON app_exitly.valuation_snapshots FOR ALL TO authenticated
  USING (app_exitly.can_access_business(business_id))
  WITH CHECK (app_exitly.can_access_business(business_id));
