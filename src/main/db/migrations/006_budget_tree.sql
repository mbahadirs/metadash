ALTER TABLE ad_insights_daily ADD COLUMN parent_id TEXT;
CREATE TABLE IF NOT EXISTS ad_budget_overrides (
  act_id    TEXT REFERENCES ad_accounts(act_id),
  level     TEXT,
  object_id TEXT,
  amount    REAL,
  updated_at INTEGER,
  PRIMARY KEY (act_id, level, object_id)
);
CREATE INDEX IF NOT EXISTS idx_ads_parent ON ad_insights_daily(act_id, level, parent_id);
