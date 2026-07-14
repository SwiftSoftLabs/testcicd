CREATE SCHEMA IF NOT EXISTS app_aetherstrike;

GRANT USAGE ON SCHEMA app_aetherstrike TO app_aetherstrike_user;

CREATE TABLE app_aetherstrike.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE,
  avatar_url    TEXT,
  level         INT NOT NULL DEFAULT 1,
  xp            INT NOT NULL DEFAULT 0,
  xp_to_next    INT NOT NULL DEFAULT 3000,
  clan          TEXT,
  title         TEXT DEFAULT 'Rookie Striker',
  kit_name      TEXT DEFAULT 'Standard Kit',
  kit_rarity    TEXT DEFAULT 'Common',
  is_anonymous  BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION app_aetherstrike.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE _username TEXT;
BEGIN
  _username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    'Striker_' || SUBSTRING(NEW.id::TEXT, 1, 6)
  );
  INSERT INTO app_aetherstrike.profiles (id, username, is_anonymous)
  VALUES (NEW.id, _username, (NEW.raw_user_meta_data->>'provider' = 'anonymous'))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app_aetherstrike.handle_new_user();

CREATE TABLE app_aetherstrike.economy (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  credits    BIGINT NOT NULL DEFAULT 5000 CHECK (credits >= 0),
  gems       INT    NOT NULL DEFAULT 100  CHECK (gems >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION app_aetherstrike.handle_new_economy()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO app_aetherstrike.economy (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_profile_economy
  AFTER INSERT ON app_aetherstrike.profiles
  FOR EACH ROW EXECUTE FUNCTION app_aetherstrike.handle_new_economy();

CREATE TABLE app_aetherstrike.player_stats (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  goals            INT NOT NULL DEFAULT 0,
  assists          INT NOT NULL DEFAULT 0,
  steals           INT NOT NULL DEFAULT 0,
  defends          INT NOT NULL DEFAULT 0,
  matches_played   INT NOT NULL DEFAULT 0,
  matches_won      INT NOT NULL DEFAULT 0,
  eliminations     INT NOT NULL DEFAULT 0,
  times_eliminated INT NOT NULL DEFAULT 0,
  cumulative_score BIGINT NOT NULL DEFAULT 0,
  safety_count     INT NOT NULL DEFAULT 1 CHECK (safety_count >= 0 AND safety_count <= 3),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION app_aetherstrike.handle_new_stats()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO app_aetherstrike.player_stats (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_profile_stats
  AFTER INSERT ON app_aetherstrike.profiles
  FOR EACH ROW EXECUTE FUNCTION app_aetherstrike.handle_new_stats();

CREATE TABLE app_aetherstrike.achievement_defs (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '🏆',
  rarity      TEXT NOT NULL DEFAULT 'Common'
);

INSERT INTO app_aetherstrike.achievement_defs (key, name, description, icon, rarity) VALUES
  ('first_goal',    'Striker Elite',  'Score your first goal',               '⚡', 'Common'),
  ('void_survivor', 'Void Walker',    'Survive 10 elimination rounds',        '🌀', 'Rare'),
  ('iron_defense',  'Iron Defense',   'Record 100 successful defends',        '🛡️', 'Epic'),
  ('speed_demon',   'Speed Demon',    'Score 5 goals in a single session',    '💨', 'Rare'),
  ('safety_hoarder','Safety Net',     'Hold 3 Safety shields simultaneously', '🔰', 'Legendary'),
  ('century_club',  'Century Club',   'Reach 100 cumulative goals',           '💯', 'Legendary')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE app_aetherstrike.player_achievements (
  id             SERIAL PRIMARY KEY,
  player_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_id INT  NOT NULL REFERENCES app_aetherstrike.achievement_defs(id),
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, achievement_id)
);

CREATE TABLE app_aetherstrike.store_items (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT 'SKINS',
  rarity         TEXT NOT NULL DEFAULT 'Common',
  price_gems     INT,
  price_credits  BIGINT,
  emoji          TEXT NOT NULL DEFAULT '🎁',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_aetherstrike.store_items (name, description, category, rarity, price_gems, price_credits, emoji) VALUES
  ('Void Striker',     'Cybernetic Exo-Suit customization.',     'FEATURED', 'Legendary', 1200, NULL,  '🤖'),
  ('Neon Cleats',      'High velocity trail effects.',           'SKINS',    'Epic',       800, NULL,  '👟'),
  ('Speed Boost x5',   'Temporary agility boost for 5 matches.', 'BOOSTS',   'Common',    NULL, 2000,  '⚡'),
  ('Plasma Kit',       'Plasma-coated full-body skin.',          'SKINS',    'Rare',       500, NULL,  '🔵'),
  ('Null Zone Bundle', 'Kit + 10 boosts + exclusive title.',     'BUNDLES',  'Legendary', 2500, NULL,  '📦'),
  ('Safety Shield x3', 'Extra Safety tokens for 3 spawns.',      'BOOSTS',   'Rare',       300, NULL,  '🛡️'),
  ('Neo-Tokyo Kit',    'Fan-favourite Neo-Tokyo aesthetic.',     'FEATURED', 'Legendary', 1500, NULL,  '🏙️'),
  ('Credit Booster',   '2x Credits for 24 hours.',               'BOOSTS',   'Common',    NULL, 5000,  '💰')
ON CONFLICT DO NOTHING;

CREATE TABLE app_aetherstrike.inventory (
  id          SERIAL PRIMARY KEY,
  player_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id     INT  NOT NULL REFERENCES app_aetherstrike.store_items(id),
  quantity    INT  NOT NULL DEFAULT 1 CHECK (quantity > 0),
  equipped    BOOLEAN NOT NULL DEFAULT FALSE,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, item_id)
);

CREATE TABLE app_aetherstrike.rooms (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'ROYAL RUMBLE',
  status        TEXT NOT NULL DEFAULT 'waiting',
  max_players   INT  NOT NULL DEFAULT 50,
  region        TEXT NOT NULL DEFAULT 'TOKYO-03',
  tier          TEXT NOT NULL DEFAULT 'Any Rank',
  latency_ms    INT  NOT NULL DEFAULT 20,
  is_private    BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash TEXT,
  host_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_aetherstrike.rooms (name, mode, status, max_players, region, tier, latency_ms, is_private) VALUES
  ('NEON-ARENA-04',  'ROYAL RUMBLE',  'active',  50, 'TOKYO-03',    'Gold+',       12,  FALSE),
  ('SECTOR 7-ALPHA', 'SUDDEN DEATH',  'waiting', 50, 'TOKYO-03',    'Any Rank',    24,  FALSE),
  ('MAGMA CORE',     'HARDCORE MODE', 'active',  50, 'SINGAPORE-01','Veteran+',    45,  FALSE),
  ('VOID CHAMBER',   'ROYAL RUMBLE',  'waiting', 50, 'LA-02',       'Any Rank',    88,  FALSE),
  ('CLAN SCRIMS A',  'PRIVATE LOBBY', 'waiting', 10, 'TOKYO-03',    'Invite Only', 8,   TRUE)
ON CONFLICT DO NOTHING;

CREATE TABLE app_aetherstrike.room_members (
  id           SERIAL PRIMARY KEY,
  room_id      INT  NOT NULL REFERENCES app_aetherstrike.rooms(id) ON DELETE CASCADE,
  player_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'spectator',
  team         INT,
  score        INT NOT NULL DEFAULT 0,
  safety_count INT NOT NULL DEFAULT 1,
  is_alive     BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, player_id)
);

CREATE TABLE app_aetherstrike.matches (
  id            SERIAL PRIMARY KEY,
  room_id       INT  REFERENCES app_aetherstrike.rooms(id) ON DELETE SET NULL,
  score_team_a  INT  NOT NULL DEFAULT 0,
  score_team_b  INT  NOT NULL DEFAULT 0,
  winner_team   INT,
  duration_secs INT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ
);

CREATE TABLE app_aetherstrike.messages (
  id        SERIAL PRIMARY KEY,
  channel   TEXT NOT NULL DEFAULT 'global',
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body      TEXT NOT NULL CHECK (LENGTH(body) <= 500),
  type      TEXT NOT NULL DEFAULT 'text',
  metadata  JSONB,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_channel_time ON app_aetherstrike.messages (channel, sent_at DESC);

CREATE TABLE app_aetherstrike.friendships (
  id         SERIAL PRIMARY KEY,
  requester  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requester, addressee),
  CHECK (requester <> addressee)
);

CREATE TABLE app_aetherstrike.user_settings (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  graphics_quality TEXT NOT NULL DEFAULT 'HIGH',
  fps_target       INT  NOT NULL DEFAULT 60,
  bloom_effects    BOOLEAN NOT NULL DEFAULT TRUE,
  motion_blur      BOOLEAN NOT NULL DEFAULT FALSE,
  master_volume    INT  NOT NULL DEFAULT 85 CHECK (master_volume BETWEEN 0 AND 100),
  sfx_volume       INT  NOT NULL DEFAULT 70 CHECK (sfx_volume BETWEEN 0 AND 100),
  spatial_audio    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION app_aetherstrike.handle_new_settings()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO app_aetherstrike.user_settings (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_profile_settings
  AFTER INSERT ON app_aetherstrike.profiles
  FOR EACH ROW EXECUTE FUNCTION app_aetherstrike.handle_new_settings();

CREATE OR REPLACE VIEW app_aetherstrike.leaderboard AS
SELECT
  p.id, p.username, p.level, p.clan, p.avatar_url,
  s.goals, s.assists, s.matches_played, s.matches_won, s.cumulative_score,
  CASE WHEN s.matches_played > 0
    THEN ROUND(s.matches_won::NUMERIC / s.matches_played * 100, 1) ELSE 0 END AS win_rate,
  RANK() OVER (ORDER BY s.cumulative_score DESC) AS rank
FROM app_aetherstrike.profiles p
JOIN app_aetherstrike.player_stats s ON s.id = p.id;

ALTER TABLE app_aetherstrike.profiles          ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_aetherstrike.economy           ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_aetherstrike.player_stats      ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_aetherstrike.player_achievements ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_aetherstrike.inventory         ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_aetherstrike.room_members      ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_aetherstrike.messages          ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_aetherstrike.friendships       ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_aetherstrike.user_settings     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_read_all"   ON app_aetherstrike.profiles FOR SELECT USING (TRUE);

CREATE POLICY "profiles_insert_own" ON app_aetherstrike.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON app_aetherstrike.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "economy_own"   ON app_aetherstrike.economy   FOR ALL USING (auth.uid() = id);

CREATE POLICY "stats_read"    ON app_aetherstrike.player_stats FOR SELECT USING (TRUE);

CREATE POLICY "stats_own"     ON app_aetherstrike.player_stats FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "achievements_read"   ON app_aetherstrike.player_achievements FOR SELECT USING (TRUE);

CREATE POLICY "achievements_insert" ON app_aetherstrike.player_achievements FOR INSERT WITH CHECK (auth.uid() = player_id);

CREATE POLICY "inventory_own"       ON app_aetherstrike.inventory     FOR ALL USING (auth.uid() = player_id);

CREATE POLICY "room_members_read"   ON app_aetherstrike.room_members  FOR SELECT USING (TRUE);

CREATE POLICY "room_members_own"    ON app_aetherstrike.room_members  FOR ALL    USING (auth.uid() = player_id);

CREATE POLICY "messages_read"       ON app_aetherstrike.messages      FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "messages_insert"     ON app_aetherstrike.messages      FOR INSERT WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "friendships_own"     ON app_aetherstrike.friendships   FOR ALL    USING (auth.uid() IN (requester, addressee));

CREATE POLICY "settings_own"        ON app_aetherstrike.user_settings FOR ALL    USING (auth.uid() = id);

GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA app_aetherstrike TO app_aetherstrike_user;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app_aetherstrike TO app_aetherstrike_user;

GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app_aetherstrike TO app_aetherstrike_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_aetherstrike GRANT ALL PRIVILEGES ON TABLES    TO app_aetherstrike_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_aetherstrike GRANT ALL PRIVILEGES ON SEQUENCES TO app_aetherstrike_user;
