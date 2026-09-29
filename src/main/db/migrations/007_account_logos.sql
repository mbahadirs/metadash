-- Optional per-account client logo for white-label reports (image data URL, validated before insert).
CREATE TABLE IF NOT EXISTS account_logos (
  ig_id      TEXT PRIMARY KEY REFERENCES accounts(ig_id) ON DELETE CASCADE,
  data_url   TEXT NOT NULL,
  updated_at INTEGER
);
