CREATE TABLE IF NOT EXISTS ad_media_links (
  act_id   TEXT REFERENCES ad_accounts(act_id),
  ad_id    TEXT,
  media_id TEXT,
  ad_name  TEXT,
  linked_at INTEGER,
  PRIMARY KEY (act_id, ad_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_media_links_media ON ad_media_links(media_id);
CREATE INDEX IF NOT EXISTS idx_ads_level_object ON ad_insights_daily(level, object_id, date);
