CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app_stitchframe;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_stitchframe_user') THEN
    CREATE ROLE app_stitchframe_user LOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM app_stitchframe_user;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_stitchframe_user;

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM app_stitchframe_user;

REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM app_stitchframe_user;

GRANT USAGE, CREATE ON SCHEMA app_stitchframe TO app_stitchframe_user;

GRANT USAGE ON SCHEMA app_stitchframe TO anon, authenticated;

ALTER ROLE app_stitchframe_user SET search_path TO app_stitchframe;

CREATE OR REPLACE FUNCTION app_stitchframe.is_max_member_safe()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result boolean;
BEGIN
  BEGIN
    EXECUTE 'SELECT public.is_max_member()' INTO result;
    RETURN COALESCE(result, false);
  EXCEPTION WHEN undefined_function THEN
    RETURN false;
  END;
END;
$$;

CREATE TABLE IF NOT EXISTS app_stitchframe.brand_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  app_origin text NOT NULL DEFAULT 'app_stitchframe',
  name text NOT NULL,
  logo_url text,
  primary_hex text NOT NULL DEFAULT '#1A73E8',
  typography text NOT NULL DEFAULT 'Inter',
  credits_used integer NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  credits_limit integer NOT NULL DEFAULT 10000 CHECK (credits_limit > 0),
  demo_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_kits_app_origin_check CHECK (app_origin = 'app_stitchframe'),
  CONSTRAINT brand_kits_primary_hex_check CHECK (primary_hex ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE IF NOT EXISTS app_stitchframe.brand_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES app_stitchframe.brand_kits(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('Brand Owner', 'Designer', 'Marketing Manager')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, user_id)
);

CREATE OR REPLACE FUNCTION app_stitchframe.can_access_brand(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app_stitchframe, public, pg_temp
AS $$
  SELECT app_stitchframe.is_max_member_safe()
    OR EXISTS (
      SELECT 1
      FROM app_stitchframe.brand_kits b
      WHERE b.id = p_brand_id
        AND (b.demo_public OR b.owner_user_id = (SELECT auth.uid()))
    )
    OR EXISTS (
      SELECT 1
      FROM app_stitchframe.brand_members m
      WHERE m.brand_id = p_brand_id
        AND m.user_id = (SELECT auth.uid())
    );
$$;

CREATE TABLE IF NOT EXISTS app_stitchframe.garment_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES app_stitchframe.brand_kits(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sku text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('Upper Body', 'Lower Body', 'Dress')),
  confidence integer NOT NULL DEFAULT 80 CHECK (confidence BETWEEN 0 AND 100),
  fabric text NOT NULL DEFAULT 'Pending texture read',
  raw_asset_url text,
  mask_asset_url text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'segmenting', 'rendering', 'review', 'approved', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  demo_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, sku)
);

CREATE TABLE IF NOT EXISTS app_stitchframe.inference_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES app_stitchframe.brand_kits(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES app_stitchframe.garment_assets(id) ON DELETE SET NULL,
  model_profile text NOT NULL,
  body_type text NOT NULL DEFAULT 'inclusive library',
  environment text NOT NULL,
  style_reference text,
  localized_edits jsonb NOT NULL DEFAULT '[]'::jsonb,
  pipeline text[] NOT NULL DEFAULT ARRAY['SAM segmentation', 'DensePose mapping', 'GarmentNet feature extraction', 'TryonNet synthesis', 'C2PA provenance'],
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'segmenting', 'rendering', 'review', 'approved', 'failed')),
  estimate_seconds integer NOT NULL DEFAULT 42,
  demo_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_stitchframe.batch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES app_stitchframe.brand_kits(id) ON DELETE CASCADE,
  collection text NOT NULL,
  item_count integer NOT NULL CHECK (item_count >= 0),
  completed integer NOT NULL DEFAULT 0 CHECK (completed >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  throttle integer NOT NULL DEFAULT 4 CHECK (throttle > 0),
  destination text NOT NULL CHECK (destination IN ('Shopify', 'Amazon', 'Wholesale Portal')),
  seo_status text NOT NULL DEFAULT 'Mapped',
  demo_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_stitchframe.gallery_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES app_stitchframe.brand_kits(id) ON DELETE CASCADE,
  garment_asset_id uuid REFERENCES app_stitchframe.garment_assets(id) ON DELETE SET NULL,
  title text NOT NULL,
  collection text NOT NULL,
  model text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  export_state text NOT NULL CHECK (export_state IN ('WebP ready', '1080p ready', '4K ready')),
  provenance text NOT NULL CHECK (provenance IN ('C2PA embedded', 'Queued')),
  share_token text UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  demo_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_stitchframe.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES app_stitchframe.brand_kits(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stitchframe_assets_brand_status_idx ON app_stitchframe.garment_assets (brand_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS stitchframe_batch_brand_created_idx ON app_stitchframe.batch_jobs (brand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS stitchframe_gallery_brand_collection_idx ON app_stitchframe.gallery_assets (brand_id, collection);

CREATE INDEX IF NOT EXISTS stitchframe_members_user_idx ON app_stitchframe.brand_members (user_id, brand_id);

ALTER TABLE app_stitchframe.brand_kits ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_stitchframe.brand_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_stitchframe.garment_assets ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_stitchframe.inference_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_stitchframe.batch_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_stitchframe.gallery_assets ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_stitchframe.audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_kits_read ON app_stitchframe.brand_kits;

CREATE POLICY brand_kits_read ON app_stitchframe.brand_kits FOR SELECT TO anon, authenticated
  USING (demo_public OR app_stitchframe.is_max_member_safe() OR owner_user_id = (SELECT auth.uid()) OR app_stitchframe.can_access_brand(id));

DROP POLICY IF EXISTS brand_kits_write ON app_stitchframe.brand_kits;

CREATE POLICY brand_kits_write ON app_stitchframe.brand_kits FOR ALL TO authenticated
  USING (app_stitchframe.is_max_member_safe() OR owner_user_id = (SELECT auth.uid()))
  WITH CHECK (app_stitchframe.is_max_member_safe() OR owner_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS brand_members_access ON app_stitchframe.brand_members;

CREATE POLICY brand_members_access ON app_stitchframe.brand_members FOR ALL TO authenticated
  USING (app_stitchframe.can_access_brand(brand_id))
  WITH CHECK (app_stitchframe.can_access_brand(brand_id));

DROP POLICY IF EXISTS garment_assets_read ON app_stitchframe.garment_assets;

CREATE POLICY garment_assets_read ON app_stitchframe.garment_assets FOR SELECT TO anon, authenticated
  USING (demo_public OR app_stitchframe.can_access_brand(brand_id));

DROP POLICY IF EXISTS garment_assets_write ON app_stitchframe.garment_assets;

CREATE POLICY garment_assets_write ON app_stitchframe.garment_assets FOR ALL TO authenticated
  USING (app_stitchframe.can_access_brand(brand_id))
  WITH CHECK (app_stitchframe.can_access_brand(brand_id));

DROP POLICY IF EXISTS inference_jobs_read ON app_stitchframe.inference_jobs;

CREATE POLICY inference_jobs_read ON app_stitchframe.inference_jobs FOR SELECT TO anon, authenticated
  USING (demo_public OR app_stitchframe.can_access_brand(brand_id));

DROP POLICY IF EXISTS inference_jobs_write ON app_stitchframe.inference_jobs;

CREATE POLICY inference_jobs_write ON app_stitchframe.inference_jobs FOR ALL TO authenticated
  USING (app_stitchframe.can_access_brand(brand_id))
  WITH CHECK (app_stitchframe.can_access_brand(brand_id));

DROP POLICY IF EXISTS batch_jobs_read ON app_stitchframe.batch_jobs;

CREATE POLICY batch_jobs_read ON app_stitchframe.batch_jobs FOR SELECT TO anon, authenticated
  USING (demo_public OR app_stitchframe.can_access_brand(brand_id));

DROP POLICY IF EXISTS batch_jobs_write ON app_stitchframe.batch_jobs;

CREATE POLICY batch_jobs_write ON app_stitchframe.batch_jobs FOR ALL TO authenticated
  USING (app_stitchframe.can_access_brand(brand_id))
  WITH CHECK (app_stitchframe.can_access_brand(brand_id));

DROP POLICY IF EXISTS gallery_assets_read ON app_stitchframe.gallery_assets;

CREATE POLICY gallery_assets_read ON app_stitchframe.gallery_assets FOR SELECT TO anon, authenticated
  USING (demo_public OR app_stitchframe.can_access_brand(brand_id));

DROP POLICY IF EXISTS gallery_assets_write ON app_stitchframe.gallery_assets;

CREATE POLICY gallery_assets_write ON app_stitchframe.gallery_assets FOR ALL TO authenticated
  USING (app_stitchframe.can_access_brand(brand_id))
  WITH CHECK (app_stitchframe.can_access_brand(brand_id));

DROP POLICY IF EXISTS audit_events_read ON app_stitchframe.audit_events;

CREATE POLICY audit_events_read ON app_stitchframe.audit_events FOR SELECT TO authenticated
  USING (app_stitchframe.can_access_brand(brand_id));

DROP POLICY IF EXISTS audit_events_insert ON app_stitchframe.audit_events;

CREATE POLICY audit_events_insert ON app_stitchframe.audit_events FOR INSERT TO authenticated
  WITH CHECK (app_stitchframe.can_access_brand(brand_id));

CREATE OR REPLACE TRIGGER brand_kits_updated_at
  BEFORE UPDATE ON app_stitchframe.brand_kits
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE TRIGGER garment_assets_updated_at
  BEFORE UPDATE ON app_stitchframe.garment_assets
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE TRIGGER inference_jobs_updated_at
  BEFORE UPDATE ON app_stitchframe.inference_jobs
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE TRIGGER batch_jobs_updated_at
  BEFORE UPDATE ON app_stitchframe.batch_jobs
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE TRIGGER gallery_assets_updated_at
  BEFORE UPDATE ON app_stitchframe.gallery_assets
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_stitchframe TO app_stitchframe_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_stitchframe TO app_stitchframe_user;

GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app_stitchframe TO app_stitchframe_user;

GRANT SELECT ON ALL TABLES IN SCHEMA app_stitchframe TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app_stitchframe TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app_stitchframe TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_stitchframe GRANT ALL PRIVILEGES ON TABLES TO app_stitchframe_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_stitchframe GRANT ALL PRIVILEGES ON SEQUENCES TO app_stitchframe_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_stitchframe GRANT ALL PRIVILEGES ON FUNCTIONS TO app_stitchframe_user;

DO $$
DECLARE
  schema_name text;
BEGIN
  FOR schema_name IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname LIKE 'app\_%'
      AND nspname <> 'app_stitchframe'
  LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM app_stitchframe_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM app_stitchframe_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM app_stitchframe_user', schema_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM app_stitchframe_user', schema_name);
  END LOOP;
END
$$;

INSERT INTO app_stitchframe.brand_kits (
  id, name, primary_hex, typography, credits_used, credits_limit, demo_public
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Atelier Kora',
  '#1A73E8',
  'Inter',
  3840,
  10000,
  true
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  primary_hex = EXCLUDED.primary_hex,
  typography = EXCLUDED.typography,
  credits_used = EXCLUDED.credits_used,
  credits_limit = EXCLUDED.credits_limit,
  demo_public = EXCLUDED.demo_public,
  updated_at = now();

INSERT INTO app_stitchframe.garment_assets (
  id, brand_id, sku, name, category, confidence, fabric, status, metadata, demo_public
) VALUES
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111111', 'KORA-BLZ-041', 'Washed linen blazer', 'Upper Body', 96, 'Linen twill', 'approved', '{"dominant_color":"blue"}', true),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111111', 'KORA-DRS-204', 'Column rib dress', 'Dress', 91, 'Cotton rib', 'rendering', '{"dominant_color":"plum"}', true),
  ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111111', 'KORA-TRS-118', 'Pleated wide trouser', 'Lower Body', 88, 'Wool blend', 'review', '{"dominant_color":"green"}', true)
ON CONFLICT (brand_id, sku) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  confidence = EXCLUDED.confidence,
  fabric = EXCLUDED.fabric,
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  demo_public = EXCLUDED.demo_public,
  updated_at = now();

INSERT INTO app_stitchframe.batch_jobs (
  id, brand_id, collection, item_count, completed, failed, throttle, destination, seo_status, demo_public
) VALUES
  ('33333333-3333-4333-8333-333333333301', '11111111-1111-4111-8111-111111111111', 'Resort 2027', 480, 337, 6, 7, 'Shopify', 'Mapped', true),
  ('33333333-3333-4333-8333-333333333302', '11111111-1111-4111-8111-111111111111', 'Wholesale capsule', 126, 126, 0, 3, 'Wholesale Portal', 'Mapped', true),
  ('33333333-3333-4333-8333-333333333303', '11111111-1111-4111-8111-111111111111', 'Marketplace refresh', 2400, 812, 19, 12, 'Amazon', 'Mapped', true)
ON CONFLICT (id) DO UPDATE SET
  collection = EXCLUDED.collection,
  item_count = EXCLUDED.item_count,
  completed = EXCLUDED.completed,
  failed = EXCLUDED.failed,
  throttle = EXCLUDED.throttle,
  destination = EXCLUDED.destination,
  seo_status = EXCLUDED.seo_status,
  demo_public = EXCLUDED.demo_public,
  updated_at = now();

INSERT INTO app_stitchframe.gallery_assets (
  id, brand_id, garment_asset_id, title, collection, model, version, export_state, provenance, demo_public
) VALUES
  ('44444444-4444-4444-8444-444444444401', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222201', 'Linen blazer, greenhouse set', 'Resort 2027', 'Mara, size 12', 4, '4K ready', 'C2PA embedded', true),
  ('44444444-4444-4444-8444-444444444402', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222202', 'Rib dress, gallery light', 'Core icons', 'Inez, size 8', 2, '1080p ready', 'Queued', true),
  ('44444444-4444-4444-8444-444444444403', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222203', 'Wide trouser, dusk street', 'Wholesale capsule', 'Sana, size 18', 7, 'WebP ready', 'C2PA embedded', true)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  collection = EXCLUDED.collection,
  model = EXCLUDED.model,
  version = EXCLUDED.version,
  export_state = EXCLUDED.export_state,
  provenance = EXCLUDED.provenance,
  demo_public = EXCLUDED.demo_public,
  updated_at = now();
