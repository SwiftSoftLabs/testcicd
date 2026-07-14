ALTER TABLE app_circa.listings
  ADD COLUMN IF NOT EXISTS daily_rate_cents       BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS security_deposit_cents BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_rental_days        INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS availability           JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS location_city          TEXT,
  ADD COLUMN IF NOT EXISTS location_geohash       TEXT,
  ADD COLUMN IF NOT EXISTS authenticity_score     NUMERIC(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views_count            INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes_count            INT DEFAULT 0;

ALTER TABLE app_circa.profiles
  ADD COLUMN IF NOT EXISTS bio                    TEXT,
  ADD COLUMN IF NOT EXISTS lender_score           NUMERIC(3,2) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS renter_score           NUMERIC(3,2) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS transaction_count      INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kyc_level              INT DEFAULT 0 CHECK (kyc_level BETWEEN 0 AND 3),
  ADD COLUMN IF NOT EXISTS stripe_connect_id      TEXT,
  ADD COLUMN IF NOT EXISTS pending_balance_cents  BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_earned_cents     BIGINT DEFAULT 0;

CREATE TABLE IF NOT EXISTS app_circa.favorites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id   UUID NOT NULL REFERENCES app_circa.listings(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, listing_id)
);

ALTER TABLE app_circa.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorites_own" ON app_circa.favorites
  FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS app_circa.reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES app_circa.transactions(id) ON DELETE CASCADE,
  reviewer_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewee_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating          INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (transaction_id, reviewer_id)
);

ALTER TABLE app_circa.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews_read_public" ON app_circa.reviews FOR SELECT USING (TRUE);

CREATE POLICY "reviews_create_own" ON app_circa.reviews
  FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

CREATE TABLE IF NOT EXISTS app_circa.messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_circa.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_own" ON app_circa.messages
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE app_circa.transactions
  ADD COLUMN IF NOT EXISTS logistics_provider TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url       TEXT,
  ADD COLUMN IF NOT EXISTS access_code        TEXT,
  ADD COLUMN IF NOT EXISTS check_in_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_out_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lender_snapshot    JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS listing_snapshot   JSONB DEFAULT '{}';

DO $$
BEGIN
  -- Insert seed listings only if none exist
  IF NOT EXISTS (SELECT 1 FROM app_circa.listings WHERE status = 'active' LIMIT 1) THEN

    INSERT INTO app_circa.listings (title, description, category, brand, condition,
      price_cents, daily_rate_cents, security_deposit_cents, mode, images,
      certified, status, authenticity_score, location_city, likes_count, owner_id)
    VALUES
    ('Patek Philippe Nautilus 5711',
     'Pristine. Complete set with box and papers. Ref 5711/1A-010.',
     'Timepieces', 'Patek Philippe', 'Excellent',
     9500000, 0, 0, 'sell',
     ARRAY['https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=800'],
     true, 'active', 0.99, 'New York', 47,
     (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)),

    ('Hermès Birkin 35 — Togo Etoupe',
     'Gold hardware. One prior owner. Dust bag and lock included.',
     'Accessories', 'Hermès', 'Very Good',
     1200000, 80000, 300000, 'rent',
     ARRAY['https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800'],
     true, 'active', 0.97, 'Los Angeles', 63,
     (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)),

    ('Leica M11 + Summilux 50mm f/1.4',
     'Under 5k actuations. Original box. Perfect for editorial.',
     'Photography', 'Leica', 'Excellent',
     120000, 18000, 80000, 'rent',
     ARRAY['https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800'],
     true, 'active', 0.95, 'New York', 29,
     (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)),

    ('Porsche 911 GT3 RS (992)',
     'Weissach package, Pyro Silver. Weekend rentals only.',
     'Automotive', 'Porsche', 'Excellent',
     0, 250000, 2000000, 'rent',
     ARRAY['https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?w=800'],
     true, 'active', 0.99, 'Miami', 112,
     (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)),

    ('Rolex Daytona 116500LN — White Dial',
     '2023, card, box, papers. Unworn condition.',
     'Timepieces', 'Rolex', 'Excellent',
     3200000, 0, 0, 'sell',
     ARRAY['https://images.unsplash.com/photo-1587836374828-4dbafa94cf0e?w=800'],
     true, 'active', 0.98, 'New York', 88,
     (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)),

    ('Sony A7R V + 3-Lens Kit',
     '24-70 GM II, 85mm f/1.4 GM, 16-35 GM. All hoods included.',
     'Photography', 'Sony', 'Very Good',
     45000, 8000, 40000, 'rent',
     ARRAY['https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800'],
     false, 'active', 0.91, 'Chicago', 21,
     (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)),

    ('Apple Vision Pro (256GB)',
     'Gen 1, all accessories, developer tools unlocked.',
     'Electronics', 'Apple', 'Excellent',
     349900, 15000, 100000, 'rent',
     ARRAY['https://images.unsplash.com/photo-1706353526173-f9cb40a2c35b?w=800'],
     false, 'active', 0.94, 'San Francisco', 55,
     (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)),

    ('Louis Vuitton Keepall 55 Bandoulière',
     'Monogram canvas. Luggage tag and lock included.',
     'Accessories', 'Louis Vuitton', 'Good',
     180000, 12000, 50000, 'rent',
     ARRAY['https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=800'],
     false, 'active', 0.88, 'Los Angeles', 18,
     (SELECT id FROM auth.users ORDER BY created_at LIMIT 1));

  END IF;
END
$$;
