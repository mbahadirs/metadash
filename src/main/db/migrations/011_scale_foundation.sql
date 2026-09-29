-- v2.0 foundation: YouTube/TikTok columns, multi-profile OAuth auths, API quota ledger, cross-process leases.
-- media: video length (YouTube ISO-8601 duration, TikTok duration) in seconds.
ALTER TABLE media ADD COLUMN duration_s INTEGER;
-- media_latest: watch metrics (YouTube Analytics); null on every other platform.
ALTER TABLE media_latest ADD COLUMN watch_time_min REAL;
ALTER TABLE media_latest ADD COLUMN avg_view_duration_s REAL;
ALTER TABLE media_latest ADD COLUMN avg_view_pct REAL;
-- profiles: multi-profile auths ('google' = one row per YouTube channel, 'tiktok' = one row per TikTok account).
-- 'meta' / 'threads' keep one active row and leave these null.
ALTER TABLE profiles ADD COLUMN external_id TEXT;        -- channel id / TikTok open_id
ALTER TABLE profiles ADD COLUMN scopes TEXT;             -- JSON string[] of granted scopes
ALTER TABLE profiles ADD COLUMN refresh_ref TEXT;        -- settings key of the encrypted refresh token (storeToken)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_platform_ext ON profiles(platform, external_id) WHERE external_id IS NOT NULL;
-- Per-provider daily API unit ledger (YouTube Data API quota; `day` in the provider's reset timezone, e.g. PT date;
-- provider may carry a project suffix: 'youtube:<clientIdHash>').
CREATE TABLE IF NOT EXISTS api_quota (
  provider TEXT NOT NULL,
  day      TEXT NOT NULL,
  units    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, day)
);
-- Cross-process leases (GUI + CLI share data.db): name = 'sync' | 'inbox' | 'team:publish' | …
CREATE TABLE IF NOT EXISTS locks (
  name        TEXT PRIMARY KEY,
  owner       TEXT,
  pid         INTEGER,
  acquired_at INTEGER,
  expires_at  INTEGER
);
