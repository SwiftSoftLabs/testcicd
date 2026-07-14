CREATE TABLE IF NOT EXISTS app_agentzero.property_media (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id     UUID NOT NULL REFERENCES app_agentzero.listings(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  media_type     TEXT DEFAULT 'image',   
  ai_tags        JSONB DEFAULT '[]',
  sort_order     INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_agentzero.property_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_public_view" ON app_agentzero.property_media FOR SELECT USING (true);

CREATE POLICY "media_host_manage" ON app_agentzero.property_media FOR ALL
  USING (auth.uid() = (SELECT host_id FROM app_agentzero.listings WHERE id = listing_id));

CREATE TABLE IF NOT EXISTS app_agentzero.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,   
  title       TEXT NOT NULL,
  body        TEXT,
  data        JSONB DEFAULT '{}',
  read        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_agentzero.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_own" ON app_agentzero.notifications FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS app_agentzero.messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES app_agentzero.offers(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_type TEXT DEFAULT 'user',  
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_agentzero.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_participant" ON app_agentzero.messages FOR ALL
  USING (
    auth.uid() = sender_id
    OR auth.uid() = (
      SELECT buyer_id FROM app_agentzero.offers WHERE id = deal_id
    )
    OR auth.uid() = (
      SELECT l.host_id FROM app_agentzero.offers o
      JOIN app_agentzero.listings l ON l.id = o.listing_id
      WHERE o.id = deal_id
    )
  );

CREATE TABLE IF NOT EXISTS app_agentzero.listing_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID NOT NULL REFERENCES app_agentzero.listings(id) ON DELETE CASCADE,
  viewer_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  viewed_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_agentzero.listing_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "views_host_see" ON app_agentzero.listing_views FOR SELECT
  USING (auth.uid() = (SELECT host_id FROM app_agentzero.listings WHERE id = listing_id));

CREATE POLICY "views_insert" ON app_agentzero.listing_views FOR INSERT WITH CHECK (true);

CREATE TABLE IF NOT EXISTS app_agentzero.closing_steps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id    UUID NOT NULL REFERENCES app_agentzero.offers(id) ON DELETE CASCADE,
  step_name   TEXT NOT NULL,
  step_order  INTEGER NOT NULL,
  status      TEXT DEFAULT 'pending',   
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_agentzero.closing_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "closing_participant" ON app_agentzero.closing_steps FOR ALL
  USING (
    auth.uid() = (SELECT buyer_id FROM app_agentzero.offers WHERE id = offer_id)
    OR auth.uid() = (
      SELECT l.host_id FROM app_agentzero.offers o
      JOIN app_agentzero.listings l ON l.id = o.listing_id
      WHERE o.id = offer_id
    )
  );

CREATE TABLE IF NOT EXISTS app_agentzero.saved_listings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id  UUID NOT NULL REFERENCES app_agentzero.listings(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, listing_id)
);

ALTER TABLE app_agentzero.saved_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_own" ON app_agentzero.saved_listings FOR ALL USING (auth.uid() = user_id);

CREATE OR REPLACE VIEW app_agentzero.listing_stats AS
SELECT
  l.id AS listing_id,
  l.host_id,
  l.address,
  l.price,
  l.status,
  COUNT(DISTINCT lv.id)::int     AS view_count,
  COUNT(DISTINCT sl.id)::int     AS save_count,
  COUNT(DISTINCT t.id)::int      AS tour_count,
  COUNT(DISTINCT o.id)::int      AS offer_count
FROM app_agentzero.listings l
LEFT JOIN app_agentzero.listing_views lv ON lv.listing_id = l.id
LEFT JOIN app_agentzero.saved_listings sl ON sl.listing_id = l.id
LEFT JOIN app_agentzero.tours t ON t.listing_id = l.id
LEFT JOIN app_agentzero.offers o ON o.listing_id = l.id
GROUP BY l.id, l.host_id, l.address, l.price, l.status;

GRANT SELECT ON app_agentzero.listing_stats TO anon, authenticated;

CREATE OR REPLACE FUNCTION app_agentzero.unread_notification_count(p_user_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COUNT(*)::int FROM app_agentzero.notifications
  WHERE user_id = p_user_id AND read = FALSE;
$$;

CREATE OR REPLACE FUNCTION app_agentzero.seed_closing_steps()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status != 'accepted' THEN
    INSERT INTO app_agentzero.closing_steps (offer_id, step_name, step_order, status)
    VALUES
      (NEW.id, 'Offer Accepted',            1, 'completed'),
      (NEW.id, 'Earnest Money Deposited',   2, 'active'),
      (NEW.id, 'Home Inspection',           3, 'pending'),
      (NEW.id, 'Appraisal',                 4, 'pending'),
      (NEW.id, 'Closing Disclosure',        5, 'pending'),
      (NEW.id, 'Keys Handed Over',          6, 'pending');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_offer_accepted ON app_agentzero.offers;

CREATE TRIGGER on_offer_accepted
  AFTER UPDATE ON app_agentzero.offers
  FOR EACH ROW EXECUTE FUNCTION app_agentzero.seed_closing_steps();

GRANT SELECT, INSERT, UPDATE, DELETE ON app_agentzero.property_media TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_agentzero.notifications TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_agentzero.messages TO anon, authenticated;

GRANT SELECT, INSERT ON app_agentzero.listing_views TO anon, authenticated;

GRANT SELECT, INSERT, DELETE ON app_agentzero.saved_listings TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON app_agentzero.closing_steps TO anon, authenticated;
