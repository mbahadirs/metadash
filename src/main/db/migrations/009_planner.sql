-- v1.4 Planner. Times are UTC ms. account_id = account key (IG raw id | fb-<id> | th-<id>); no FK so account cleanup never cascades.
CREATE TABLE IF NOT EXISTS planner_posts (
  id               INTEGER PRIMARY KEY,
  ref              TEXT UNIQUE,                       -- human code 'P-0042' (approval packs, client replies)
  title            TEXT,
  caption          TEXT NOT NULL DEFAULT '',
  first_comment    TEXT,
  status           TEXT NOT NULL DEFAULT 'draft',     -- draft|in_review|changes_requested|approved|scheduled|publishing|published|partial|failed|archived
  scheduled_at     INTEGER,                           -- null = unscheduled draft
  timezone         TEXT,                              -- IANA tz at scheduling time (display only)
  client_name      TEXT,
  labels           TEXT,                              -- JSON string[]
  notes            TEXT,                              -- internal notes (never in approval pack unless opted)
  version          INTEGER NOT NULL DEFAULT 1,        -- bumped on content change (caption/media/targets/first comment)
  approved_version INTEGER,
  approved_by      TEXT,
  approved_at      INTEGER,
  source           TEXT NOT NULL DEFAULT 'manual',    -- manual|duplicate|ai_idea|repurpose (v1.5)
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  deleted_at       INTEGER
);
CREATE TABLE IF NOT EXISTS planner_targets (
  id               INTEGER PRIMARY KEY,
  post_id          INTEGER NOT NULL REFERENCES planner_posts(id) ON DELETE CASCADE,
  account_id       TEXT NOT NULL,
  platform         TEXT NOT NULL,                     -- instagram|facebook|threads
  format           TEXT NOT NULL,                     -- ig: image|carousel|reel|story ; fb: text|link|photo|album|video|reel ; th: text|image|video|carousel
  caption_override TEXT,
  first_comment_override TEXT,
  options          TEXT,                              -- JSON {shareToFeed, coverAssetId, thumbOffsetMs, link, topicTag, locationId, collaborators[], altText{assetId:text}, children[] (container ids)}
  mode             TEXT NOT NULL DEFAULT 'app',       -- app | native (FB scheduled_publish_time)
  state            TEXT NOT NULL DEFAULT 'idle',      -- idle|queued|hosting|container|ready|handed_off|publishing|commenting|published|failed|canceled|missed|paused
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER,
  locked_at        INTEGER,
  lock_owner       TEXT,
  container_id     TEXT,                              -- IG/Threads creation id; FB scheduled/unpublished post id
  remote_id        TEXT,                              -- published id (raw API id)
  media_key        TEXT,                              -- = media.media_id once synced (IG raw, FB pageid_postid, 'th-<id>')
  permalink        TEXT,
  first_comment_id TEXT,
  last_error_code  TEXT,
  last_error       TEXT,
  fbtrace_id       TEXT,
  published_at     INTEGER,
  UNIQUE (post_id, account_id)
);
CREATE TABLE IF NOT EXISTS planner_assets (
  id           INTEGER PRIMARY KEY,
  sha256       TEXT NOT NULL UNIQUE,
  file_name    TEXT,
  stored_path  TEXT NOT NULL,                         -- relative to userData/planner-media
  mime         TEXT, kind TEXT NOT NULL,              -- image|video
  bytes        INTEGER, width INTEGER, height INTEGER, rotation INTEGER,
  duration_ms  INTEGER, video_codec TEXT, audio_codec TEXT, fps REAL,
  thumb_path   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS planner_post_assets (
  post_id   INTEGER NOT NULL REFERENCES planner_posts(id) ON DELETE CASCADE,
  asset_id  INTEGER NOT NULL REFERENCES planner_assets(id),
  position  INTEGER NOT NULL,
  role      TEXT NOT NULL DEFAULT 'media',            -- media | cover
  alt_text  TEXT,
  PRIMARY KEY (post_id, role, position)
);
CREATE TABLE IF NOT EXISTS planner_uploads (          -- remote copies used as public URLs
  id          INTEGER PRIMARY KEY,
  asset_id    INTEGER NOT NULL REFERENCES planner_assets(id),
  host        TEXT NOT NULL,                          -- s3 | fbpage | url
  object_key  TEXT,                                   -- S3 key or FB photo id
  public_url  TEXT NOT NULL,
  expires_at  INTEGER,
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE TABLE IF NOT EXISTS planner_audit (
  id        INTEGER PRIMARY KEY,
  at        INTEGER NOT NULL,
  post_id   INTEGER,
  target_id INTEGER,
  actor     TEXT NOT NULL,                            -- user | worker | system | client (approval import)
  action    TEXT NOT NULL,                            -- created|edited|status|scheduled|rescheduled|queued|container_created|published|failed|retry|canceled|missed|approved|changes_requested|pack_exported|first_comment|handed_off
  detail    TEXT                                      -- JSON (error code, fbtrace_id, from→to, attempt, version)
);
CREATE TABLE IF NOT EXISTS planner_approval_packs (
  id          TEXT PRIMARY KEY,                       -- random id
  created_at  INTEGER NOT NULL,
  title       TEXT, client_name TEXT, lang TEXT,
  items       TEXT NOT NULL,                          -- JSON [{postId, ref, version}]
  secret      TEXT NOT NULL,                          -- HMAC key for response codes
  file_path   TEXT
);
CREATE TABLE IF NOT EXISTS planner_quota (            -- IG content_publishing_limit / Threads threads_publishing_limit cache
  account_id TEXT PRIMARY KEY, used INTEGER, total INTEGER, window_sec INTEGER, checked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_planner_posts_sched ON planner_posts(scheduled_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_planner_targets_due ON planner_targets(state, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_planner_audit_post ON planner_audit(post_id, at);
