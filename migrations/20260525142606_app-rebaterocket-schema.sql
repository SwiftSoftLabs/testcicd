SET search_path TO app_rebaterocket;

CREATE TABLE IF NOT EXISTS app_rebaterocket.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  property_address TEXT,
  address_verified BOOLEAN NOT NULL DEFAULT false,
  household_size INTEGER NOT NULL DEFAULT 1,
  income_bracket TEXT CHECK (income_bracket IN ('below_80', '80_150', 'above_150')),
  onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  mfa_method TEXT CHECK (mfa_method IN ('authenticator', 'sms', 'email')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_rebaterocket.utility_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  connection_type TEXT NOT NULL CHECK (connection_type IN ('green_button', 'manual_upload')),
  account_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rebaterocket_utility_user ON app_rebaterocket.utility_connections (user_id);

CREATE TABLE IF NOT EXISTS app_rebaterocket.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT,
  document_type TEXT NOT NULL DEFAULT 'other'
    CHECK (document_type IN ('invoice', 'permit', 'utility_bill', 'receipt', 'other')),
  ocr_data JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'verified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rebaterocket_documents_user ON app_rebaterocket.documents (user_id);

CREATE TABLE IF NOT EXISTS app_rebaterocket.rebate_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rebate_name TEXT NOT NULL,
  rebate_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  upgrade_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'received', 'under_review', 'info_required', 'approved', 'payment_issued')),
  agency TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rebaterocket_applications_user ON app_rebaterocket.rebate_applications (user_id);

CREATE TABLE IF NOT EXISTS app_rebaterocket.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  type TEXT NOT NULL DEFAULT 'system' CHECK (type IN ('status', 'opportunity', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rebaterocket_notifications_user ON app_rebaterocket.notifications (user_id);

DROP TRIGGER IF EXISTS profiles_updated_at ON app_rebaterocket.profiles;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON app_rebaterocket.profiles
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

DROP TRIGGER IF EXISTS applications_updated_at ON app_rebaterocket.rebate_applications;

CREATE TRIGGER applications_updated_at
  BEFORE UPDATE ON app_rebaterocket.rebate_applications
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE app_rebaterocket.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_rebaterocket.utility_connections ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_rebaterocket.documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_rebaterocket.rebate_applications ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_rebaterocket.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user owns profile" ON app_rebaterocket.profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user owns utility connections" ON app_rebaterocket.utility_connections
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user owns documents" ON app_rebaterocket.documents
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user owns applications" ON app_rebaterocket.rebate_applications
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user owns notifications" ON app_rebaterocket.notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_max_member(auth.uid()))
  WITH CHECK (user_id = auth.uid());

GRANT USAGE ON SCHEMA app_rebaterocket TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  app_rebaterocket.profiles,
  app_rebaterocket.utility_connections,
  app_rebaterocket.documents,
  app_rebaterocket.rebate_applications,
  app_rebaterocket.notifications
  TO authenticated;
