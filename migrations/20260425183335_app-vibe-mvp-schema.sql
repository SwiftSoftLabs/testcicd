CREATE SCHEMA IF NOT EXISTS app_vibe;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_vibe_user') THEN
    CREATE ROLE app_vibe_user LOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_vibe_user;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_vibe_user;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM app_vibe_user;

REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM app_vibe_user;

GRANT USAGE, CREATE ON SCHEMA app_vibe TO app_vibe_user;

ALTER ROLE app_vibe_user SET search_path TO app_vibe;

DO $$
DECLARE
  schema_name text;
BEGIN
  FOR schema_name IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname LIKE 'app\_%'
      AND nspname <> 'app_vibe'
  LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM app_vibe_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM app_vibe_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM app_vibe_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM app_vibe_user', schema_name);
  END LOOP;
END
$$;

CREATE TABLE IF NOT EXISTS app_vibe.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  cover_image_url text,
  style_profile text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_vibe.scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES app_vibe.projects(id) ON DELETE SET NULL,
  image_url text NOT NULL,
  source text NOT NULL DEFAULT 'gallery' CHECK (source IN ('camera', 'gallery')),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  detected_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_vibe.scan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES app_vibe.scans(id) ON DELETE CASCADE,
  category text NOT NULL,
  label text NOT NULL,
  confidence numeric(5, 4),
  bbox jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_vibe.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text,
  retailer text NOT NULL,
  title text NOT NULL,
  image_url text,
  price numeric(12, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  product_url text,
  affiliate_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_vibe.item_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES app_vibe.scan_items(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app_vibe.products(id) ON DELETE CASCADE,
  match_type text NOT NULL DEFAULT 'similar' CHECK (match_type IN ('exact', 'similar', 'splurge', 'steal')),
  score numeric(5, 4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_vibe.saved_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid REFERENCES app_vibe.scan_items(id) ON DELETE CASCADE,
  product_id uuid REFERENCES app_vibe.products(id) ON DELETE CASCADE,
  project_id uuid REFERENCES app_vibe.projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS app_vibe.checkout_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_id uuid REFERENCES app_vibe.scans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'purchased')),
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  discount numeric(12, 2) NOT NULL DEFAULT 0,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_vibe.checkout_group_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES app_vibe.checkout_groups(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app_vibe.products(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price numeric(12, 2) NOT NULL DEFAULT 0,
  retailer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_vibe_projects_user_id ON app_vibe.projects(user_id);

CREATE INDEX IF NOT EXISTS idx_app_vibe_scans_user_id ON app_vibe.scans(user_id);

CREATE INDEX IF NOT EXISTS idx_app_vibe_scans_project_id ON app_vibe.scans(project_id);

CREATE INDEX IF NOT EXISTS idx_app_vibe_scan_items_scan_id ON app_vibe.scan_items(scan_id);

CREATE INDEX IF NOT EXISTS idx_app_vibe_item_matches_item_id ON app_vibe.item_matches(item_id);

CREATE INDEX IF NOT EXISTS idx_app_vibe_saved_items_user_id ON app_vibe.saved_items(user_id);

CREATE INDEX IF NOT EXISTS idx_app_vibe_checkout_groups_user_id ON app_vibe.checkout_groups(user_id);

CREATE OR REPLACE FUNCTION app_vibe.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_app_vibe_projects_touch_updated_at ON app_vibe.projects;

CREATE TRIGGER trg_app_vibe_projects_touch_updated_at
BEFORE UPDATE ON app_vibe.projects
FOR EACH ROW
EXECUTE FUNCTION app_vibe.touch_updated_at();

DROP TRIGGER IF EXISTS trg_app_vibe_scans_touch_updated_at ON app_vibe.scans;

CREATE TRIGGER trg_app_vibe_scans_touch_updated_at
BEFORE UPDATE ON app_vibe.scans
FOR EACH ROW
EXECUTE FUNCTION app_vibe.touch_updated_at();

DROP TRIGGER IF EXISTS trg_app_vibe_checkout_groups_touch_updated_at ON app_vibe.checkout_groups;

CREATE TRIGGER trg_app_vibe_checkout_groups_touch_updated_at
BEFORE UPDATE ON app_vibe.checkout_groups
FOR EACH ROW
EXECUTE FUNCTION app_vibe.touch_updated_at();

CREATE OR REPLACE FUNCTION app_vibe.refresh_checkout_totals(group_uuid uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  calc_subtotal numeric(12, 2) := 0;
  calc_discount numeric(12, 2) := 0;
BEGIN
  SELECT COALESCE(sum(quantity * price), 0) INTO calc_subtotal
  FROM app_vibe.checkout_group_items
  WHERE group_id = group_uuid;

  calc_discount := ROUND(calc_subtotal * 0.1, 2);

  UPDATE app_vibe.checkout_groups
  SET
    subtotal = calc_subtotal,
    discount = calc_discount,
    total = calc_subtotal - calc_discount
  WHERE id = group_uuid;
END
$$;

CREATE OR REPLACE FUNCTION app_vibe.after_checkout_item_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_group uuid;
BEGIN
  target_group := COALESCE(NEW.group_id, OLD.group_id);
  PERFORM app_vibe.refresh_checkout_totals(target_group);
  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS trg_app_vibe_checkout_item_totals ON app_vibe.checkout_group_items;

CREATE TRIGGER trg_app_vibe_checkout_item_totals
AFTER INSERT OR UPDATE OR DELETE ON app_vibe.checkout_group_items
FOR EACH ROW
EXECUTE FUNCTION app_vibe.after_checkout_item_change();

ALTER TABLE app_vibe.projects ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_vibe.scans ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_vibe.scan_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_vibe.products ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_vibe.item_matches ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_vibe.saved_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_vibe.checkout_groups ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_vibe.checkout_group_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_owner ON app_vibe.projects;

CREATE POLICY projects_owner ON app_vibe.projects
FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.is_max_member())
WITH CHECK (user_id = auth.uid() OR public.is_max_member());

DROP POLICY IF EXISTS scans_owner ON app_vibe.scans;

CREATE POLICY scans_owner ON app_vibe.scans
FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.is_max_member())
WITH CHECK (user_id = auth.uid() OR public.is_max_member());

DROP POLICY IF EXISTS scan_items_owner ON app_vibe.scan_items;

CREATE POLICY scan_items_owner ON app_vibe.scan_items
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM app_vibe.scans s
    WHERE s.id = scan_id
      AND (s.user_id = auth.uid() OR public.is_max_member())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM app_vibe.scans s
    WHERE s.id = scan_id
      AND (s.user_id = auth.uid() OR public.is_max_member())
  )
);

DROP POLICY IF EXISTS products_read ON app_vibe.products;

CREATE POLICY products_read ON app_vibe.products
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS item_matches_owner ON app_vibe.item_matches;

CREATE POLICY item_matches_owner ON app_vibe.item_matches
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM app_vibe.scan_items i
    JOIN app_vibe.scans s ON s.id = i.scan_id
    WHERE i.id = item_id
      AND (s.user_id = auth.uid() OR public.is_max_member())
  )
);

DROP POLICY IF EXISTS saved_items_owner ON app_vibe.saved_items;

CREATE POLICY saved_items_owner ON app_vibe.saved_items
FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.is_max_member())
WITH CHECK (user_id = auth.uid() OR public.is_max_member());

DROP POLICY IF EXISTS checkout_groups_owner ON app_vibe.checkout_groups;

CREATE POLICY checkout_groups_owner ON app_vibe.checkout_groups
FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.is_max_member())
WITH CHECK (user_id = auth.uid() OR public.is_max_member());

DROP POLICY IF EXISTS checkout_group_items_owner ON app_vibe.checkout_group_items;

CREATE POLICY checkout_group_items_owner ON app_vibe.checkout_group_items
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM app_vibe.checkout_groups g
    WHERE g.id = group_id
      AND (g.user_id = auth.uid() OR public.is_max_member())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM app_vibe.checkout_groups g
    WHERE g.id = group_id
      AND (g.user_id = auth.uid() OR public.is_max_member())
  )
);

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_vibe TO app_vibe_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_vibe TO app_vibe_user;

GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app_vibe TO app_vibe_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_vibe
GRANT ALL PRIVILEGES ON TABLES TO app_vibe_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_vibe
GRANT ALL PRIVILEGES ON SEQUENCES TO app_vibe_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_vibe
GRANT ALL PRIVILEGES ON FUNCTIONS TO app_vibe_user;
