-- v1.5 AI studio: brand voice, generation/usage log, caption variants, A/B caption tracking, comment reply suggestions.
CREATE TABLE IF NOT EXISTS brand_voice (
  account_id    TEXT PRIMARY KEY,                        -- accounts.ig_id
  brief         TEXT NOT NULL DEFAULT '',                -- editable markdown brief (what the model sees)
  profile       TEXT,                                    -- JSON {tone[], formality, avgLength, emojiRate, emojiSet[], hashtagHabit{avgCount, placement}, ctaPatterns[], hooks[], doList[], dontList[], languages[], pronoun, sampleMediaIds[]}
  source        TEXT NOT NULL DEFAULT 'manual',          -- manual | ai | ai_edited
  derived_from  INTEGER,                                 -- number of captions the AI proposal was derived from
  derived_at    INTEGER,
  provider      TEXT,
  model         TEXT,
  ai_disabled   INTEGER NOT NULL DEFAULT 0,              -- per-account AI opt-out: no data from this account is ever sent
  updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_generations (
  id            INTEGER PRIMARY KEY,
  at            INTEGER NOT NULL,
  feature       TEXT NOT NULL,                           -- voice|caption|hashtags|ideas|repurpose|reply|abtest|commentary|anomaly|ask|test
  account_id    TEXT,
  post_id       INTEGER,
  provider      TEXT,
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  images        INTEGER DEFAULT 0,
  est_cost_usd  REAL,                                    -- NULL when pricing is unknown
  duration_ms   INTEGER,
  status        TEXT,                                    -- ok | error | cancelled
  error_code    TEXT,
  sent_summary  TEXT,                                    -- JSON counts only (captions:n, images:n, chars) — never content
  output        TEXT                                     -- JSON result; only stored when 'ai.keepHistory' is true (default false)
);
CREATE TABLE IF NOT EXISTS caption_variants (
  id            INTEGER PRIMARY KEY,
  post_id       INTEGER NOT NULL REFERENCES planner_posts(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,                           -- A | B | C
  lang          TEXT,
  angle         TEXT,                                    -- e.g. question-hook | story | benefit
  text          TEXT NOT NULL,
  generation_id INTEGER REFERENCES ai_generations(id) ON DELETE SET NULL,
  chosen        INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
ALTER TABLE planner_posts ADD COLUMN ai_meta TEXT;           -- JSON {ideaId, pillar, rationale, hook, repurposedFrom:{mediaId|postId}}
ALTER TABLE planner_posts ADD COLUMN parent_post_id INTEGER; -- repurpose lineage (planner_posts.id)
CREATE TABLE IF NOT EXISTS ab_tests (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  hypothesis    TEXT,
  variable      TEXT,                                    -- caption_hook | length | emoji | cta | hashtags | other
  metric        TEXT NOT NULL DEFAULT 'reach_lift',      -- reach_lift | er | save_rate | views_lift (Threads)
  status        TEXT NOT NULL DEFAULT 'running',         -- running | concluded
  created_at    INTEGER NOT NULL,
  concluded_at  INTEGER,
  conclusion    TEXT
);
CREATE TABLE IF NOT EXISTS ab_test_items (
  id                 INTEGER PRIMARY KEY,
  test_id            INTEGER NOT NULL REFERENCES ab_tests(id) ON DELETE CASCADE,
  arm                TEXT NOT NULL,                      -- A | B | …
  target_id          INTEGER REFERENCES planner_targets(id) ON DELETE SET NULL,
  media_key          TEXT,                               -- media.media_id (from target.media_key or tagged historical media)
  caption_variant_id INTEGER REFERENCES caption_variants(id) ON DELETE SET NULL,
  created_at         INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ab_test_items_target ON ab_test_items(test_id, target_id) WHERE target_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ab_test_items_media ON ab_test_items(test_id, media_key) WHERE media_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS comment_replies (
  id            INTEGER PRIMARY KEY,
  comment_id    TEXT NOT NULL REFERENCES comments(comment_id) ON DELETE CASCADE,
  suggestion    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'suggested',       -- suggested | edited | sent | dismissed | failed
  sent_text     TEXT,
  sent_reply_id TEXT,
  sent_at       INTEGER,
  error         TEXT,
  generation_id INTEGER REFERENCES ai_generations(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_generations_at ON ai_generations(at);
CREATE INDEX IF NOT EXISTS idx_comments_media_created ON comments(media_id, created_at);
CREATE INDEX IF NOT EXISTS idx_caption_variants_post ON caption_variants(post_id);
CREATE INDEX IF NOT EXISTS idx_comment_replies_comment ON comment_replies(comment_id);
