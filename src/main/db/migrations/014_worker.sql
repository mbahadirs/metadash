-- v2.0 self-hosted publish worker. The v1.4 execution unit is planner_targets (one row per post × account, with
-- state/lease columns), so worker ownership is per target: executor 'local' (tray publisher) | 'worker'.
-- The local publisher must skip executor = 'worker' rows. revision is bumped by the desktop whenever the target's
-- payload (post caption/media/schedule or the target's overrides) changes; worker_revision = last revision the worker accepted.
ALTER TABLE planner_targets ADD COLUMN executor TEXT NOT NULL DEFAULT 'local';
ALTER TABLE planner_targets ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planner_targets ADD COLUMN worker_revision INTEGER;
ALTER TABLE planner_targets ADD COLUMN worker_status TEXT;   -- queued | publishing | published | failed | missed (worker view)
ALTER TABLE planner_targets ADD COLUMN worker_error TEXT;    -- JSON {code, message, transient}
ALTER TABLE planner_targets ADD COLUMN worker_synced_at INTEGER;
CREATE TABLE IF NOT EXISTS worker_tokens (
  token_key TEXT PRIMARY KEY, platform TEXT NOT NULL, account_id TEXT NOT NULL,
  scopes TEXT, expires_at INTEGER, pushed_at INTEGER, status TEXT
);
CREATE INDEX IF NOT EXISTS idx_planner_targets_executor ON planner_targets(executor, state);
