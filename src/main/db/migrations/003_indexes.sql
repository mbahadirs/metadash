CREATE INDEX IF NOT EXISTS idx_comments_media ON comments(media_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_account_tags_tag ON account_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_ad_breakdown_date ON ad_insights_breakdown(act_id, date);
CREATE INDEX IF NOT EXISTS idx_sync_errors_at ON sync_errors(at);
