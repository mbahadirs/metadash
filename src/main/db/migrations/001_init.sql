CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  id            INTEGER PRIMARY KEY,
  label         TEXT NOT NULL,
  app_id        TEXT NOT NULL,
  token_ref     TEXT NOT NULL,
  token_expires_at INTEGER,
  created_at    INTEGER,
  is_active     INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS accounts (
  ig_id          TEXT PRIMARY KEY,
  profile_id     INTEGER REFERENCES profiles(id),
  page_id        TEXT,
  username       TEXT NOT NULL,
  name           TEXT,
  profile_pic_url TEXT,
  biography      TEXT,
  website        TEXT,
  is_tracked     INTEGER DEFAULT 1,
  client_name    TEXT,
  color          TEXT,
  first_seen_at  INTEGER,
  last_synced_at INTEGER
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE, color TEXT
);
CREATE TABLE IF NOT EXISTS account_tags (
  ig_id TEXT REFERENCES accounts(ig_id),
  tag_id INTEGER REFERENCES tags(id),
  PRIMARY KEY (ig_id, tag_id)
);

CREATE TABLE IF NOT EXISTS account_snapshots (
  ig_id       TEXT REFERENCES accounts(ig_id),
  date        TEXT,
  followers   INTEGER,
  follows     INTEGER,
  media_count INTEGER,
  captured_at INTEGER,
  PRIMARY KEY (ig_id, date)
);

CREATE TABLE IF NOT EXISTS account_insights_daily (
  ig_id  TEXT REFERENCES accounts(ig_id),
  date   TEXT,
  metric TEXT,
  value  REAL,
  PRIMARY KEY (ig_id, date, metric)
);

CREATE TABLE IF NOT EXISTS account_demographics (
  ig_id      TEXT REFERENCES accounts(ig_id),
  captured_at INTEGER,
  dimension  TEXT,
  bucket     TEXT,
  value      REAL,
  PRIMARY KEY (ig_id, captured_at, dimension, bucket)
);

CREATE TABLE IF NOT EXISTS media (
  media_id        TEXT PRIMARY KEY,
  ig_id           TEXT REFERENCES accounts(ig_id),
  media_type      TEXT,
  media_product_type TEXT,
  caption         TEXT,
  permalink       TEXT,
  thumbnail_path  TEXT,
  posted_at       INTEGER,
  posted_hour     INTEGER,
  posted_weekday  INTEGER,
  caption_length  INTEGER,
  hashtag_count   INTEGER,
  mention_count   INTEGER,
  emoji_count     INTEGER,
  is_deleted      INTEGER DEFAULT 0,
  first_seen_at   INTEGER
);

CREATE TABLE IF NOT EXISTS media_insight_snapshots (
  media_id    TEXT REFERENCES media(media_id),
  captured_at INTEGER,
  age_hours   INTEGER,
  metric      TEXT,
  value       REAL,
  PRIMARY KEY (media_id, captured_at, metric)
);

CREATE TABLE IF NOT EXISTS media_latest (
  media_id  TEXT PRIMARY KEY REFERENCES media(media_id),
  reach REAL, views REAL, likes REAL, comments REAL,
  saved REAL, shares REAL, total_interactions REAL,
  engagement_rate REAL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS stories (
  story_id TEXT PRIMARY KEY,
  ig_id TEXT REFERENCES accounts(ig_id),
  media_type TEXT, permalink TEXT, thumbnail_path TEXT,
  posted_at INTEGER,
  reach REAL, views REAL, replies REAL,
  nav_forward REAL, nav_back REAL, nav_exit REAL, nav_next_story REAL,
  completion_rate REAL,
  captured_at INTEGER
);

CREATE TABLE IF NOT EXISTS comments (
  comment_id TEXT PRIMARY KEY,
  media_id   TEXT REFERENCES media(media_id),
  username   TEXT, text TEXT, like_count INTEGER,
  created_at INTEGER,
  is_from_owner INTEGER,
  parent_id  TEXT,
  reply_latency_minutes INTEGER
);

CREATE TABLE IF NOT EXISTS competitors (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  linked_ig_id TEXT REFERENCES accounts(ig_id),
  label TEXT,
  UNIQUE(username, linked_ig_id)
);
CREATE TABLE IF NOT EXISTS competitor_snapshots (
  competitor_id INTEGER REFERENCES competitors(id),
  date TEXT, followers INTEGER, media_count INTEGER,
  avg_likes REAL, avg_comments REAL, posts_last_7d INTEGER,
  PRIMARY KEY (competitor_id, date)
);

CREATE TABLE IF NOT EXISTS ad_accounts (
  act_id     TEXT PRIMARY KEY,
  profile_id INTEGER REFERENCES profiles(id),
  name TEXT, currency TEXT, status TEXT,
  linked_ig_id TEXT REFERENCES accounts(ig_id),
  is_tracked INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ad_insights_daily (
  act_id     TEXT REFERENCES ad_accounts(act_id),
  date       TEXT,
  level      TEXT,
  object_id  TEXT,
  object_name TEXT,
  spend REAL, impressions REAL, reach REAL, frequency REAL,
  clicks REAL, ctr REAL, cpc REAL, cpm REAL,
  results REAL, cost_per_result REAL, result_type TEXT,
  PRIMARY KEY (act_id, date, level, object_id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY,
  started_at INTEGER, finished_at INTEGER,
  scope TEXT,
  status TEXT,
  accounts_done INTEGER, accounts_total INTEGER,
  api_calls INTEGER,
  error_summary TEXT
);
CREATE TABLE IF NOT EXISTS sync_errors (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES sync_runs(id),
  ig_id TEXT, endpoint TEXT, code INTEGER, message TEXT, at INTEGER
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  entity_type TEXT, entity_id TEXT,
  body TEXT, created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_media_account_posted ON media(ig_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_mis_media_captured ON media_insight_snapshots(media_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_aid_account_date ON account_insights_daily(ig_id, date);
CREATE INDEX IF NOT EXISTS idx_ads_account_date ON ad_insights_daily(act_id, date);
CREATE INDEX IF NOT EXISTS idx_stories_account_posted ON stories(ig_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_account_date ON account_snapshots(ig_id, date);
