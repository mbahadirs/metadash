-- v1.3 multi-platform: Instagram + Facebook Pages + Threads share the same tables.
-- accounts.ig_id keeps its name but now means "account key": raw IG id, 'fb-<pageId>' or 'th-<threadsUserId>'.
-- external_id holds the raw API id that providers call the API with.
ALTER TABLE profiles ADD COLUMN platform TEXT NOT NULL DEFAULT 'meta';   -- 'meta' | 'threads'
ALTER TABLE profiles ADD COLUMN refreshed_at INTEGER;
ALTER TABLE accounts ADD COLUMN platform TEXT NOT NULL DEFAULT 'instagram'; -- instagram | facebook | threads
ALTER TABLE accounts ADD COLUMN external_id TEXT;
ALTER TABLE accounts ADD COLUMN linked_account_id TEXT;
UPDATE accounts SET external_id = ig_id WHERE external_id IS NULL;
ALTER TABLE media ADD COLUMN external_id TEXT;
UPDATE media SET external_id = media_id WHERE external_id IS NULL;
ALTER TABLE media_latest ADD COLUMN reposts REAL;
ALTER TABLE media_latest ADD COLUMN quotes REAL;
ALTER TABLE media_latest ADD COLUMN clicks REAL;
ALTER TABLE sync_errors ADD COLUMN platform TEXT;
-- Which API metric name serves a canonical metric per platform/scope (non-Instagram platforms only).
CREATE TABLE IF NOT EXISTS metric_resolution (
  platform  TEXT NOT NULL,
  scope     TEXT NOT NULL,
  canonical TEXT NOT NULL,
  api_name  TEXT,
  status    TEXT NOT NULL,          -- 'ok' | 'unsupported'
  reason    TEXT,
  updated_at INTEGER,
  PRIMARY KEY (platform, scope, canonical)
);
CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform, is_tracked);
