CREATE TABLE IF NOT EXISTS ad_insights_breakdown (
  act_id     TEXT REFERENCES ad_accounts(act_id),
  date       TEXT,
  breakdown  TEXT,
  bucket     TEXT,
  spend REAL, impressions REAL, reach REAL, clicks REAL, results REAL,
  PRIMARY KEY (act_id, date, breakdown, bucket)
);
CREATE TABLE IF NOT EXISTS disabled_metrics (
  metric TEXT PRIMARY KEY,
  scope TEXT,
  reason TEXT,
  disabled_at INTEGER
);
