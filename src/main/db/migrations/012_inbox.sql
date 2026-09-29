-- v2.0 unified inbox. Generalises the v1.5 Studio inbox (comments + comment_replies) to every platform instead of
-- adding a parallel store: comments gain platform/account columns, comment_replies becomes the reply outbox
-- (statuses suggested | edited | sending | sent | failed | dismissed), inbox_state holds workflow state.
ALTER TABLE comments ADD COLUMN platform TEXT;              -- instagram | facebook | threads | youtube
ALTER TABLE comments ADD COLUMN account_id TEXT;            -- account key (accounts.ig_id)
ALTER TABLE comments ADD COLUMN external_id TEXT;           -- raw API comment id (comment_id may be prefixed: fbc-/th-/ytc-)
ALTER TABLE comments ADD COLUMN author_id TEXT;             -- platform user/channel id when known
ALTER TABLE comments ADD COLUMN permalink TEXT;
ALTER TABLE comments ADD COLUMN is_hidden INTEGER DEFAULT 0;
ALTER TABLE comments ADD COLUMN fetched_at INTEGER;
UPDATE comments SET
  external_id = comment_id,
  account_id = (SELECT m.ig_id FROM media m WHERE m.media_id = comments.media_id),
  platform = COALESCE((SELECT a.platform FROM media m JOIN accounts a ON a.ig_id = m.ig_id WHERE m.media_id = comments.media_id), 'instagram')
WHERE platform IS NULL;
-- Reply outbox columns on the v1.5 table (one row per suggestion or send attempt).
ALTER TABLE comment_replies ADD COLUMN platform TEXT;
ALTER TABLE comment_replies ADD COLUMN account_id TEXT;
ALTER TABLE comment_replies ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comment_replies ADD COLUMN error_code TEXT;
ALTER TABLE comment_replies ADD COLUMN author TEXT;         -- team member id / name that sent it (v2.0 team)
ALTER TABLE comment_replies ADD COLUMN sending_at INTEGER;  -- set when status becomes 'sending' (crash recovery)
CREATE TABLE IF NOT EXISTS inbox_state (
  comment_id TEXT PRIMARY KEY REFERENCES comments(comment_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',            -- open | replied | done | ignored
  assignee TEXT, status_by TEXT, status_at INTEGER,
  first_response_at INTEGER, first_response_minutes INTEGER, first_response_source TEXT, -- platform | app
  is_question INTEGER DEFAULT 0,
  sentiment TEXT, sentiment_score REAL, sentiment_model TEXT, sentiment_at INTEGER
);
-- Backfill from v1.5: dismissed → done, sent from the app → replied.
INSERT OR IGNORE INTO inbox_state (comment_id, status, status_at)
  SELECT comment_id, 'done', MAX(created_at) FROM comment_replies WHERE status = 'dismissed' GROUP BY comment_id;
INSERT OR IGNORE INTO inbox_state (comment_id, status, status_at, first_response_at, first_response_source)
  SELECT comment_id, 'replied', MIN(sent_at), MIN(sent_at), 'app' FROM comment_replies WHERE status = 'sent' AND sent_at IS NOT NULL GROUP BY comment_id;
CREATE TABLE IF NOT EXISTS inbox_cursor (
  account_id TEXT NOT NULL, media_id TEXT NOT NULL, last_polled_at INTEGER, last_comment_count REAL,
  PRIMARY KEY (account_id, media_id)
);
CREATE INDEX IF NOT EXISTS idx_comments_account_created ON comments(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_inbox_state_status ON inbox_state(status, assignee);
CREATE INDEX IF NOT EXISTS idx_comment_replies_status ON comment_replies(status);
