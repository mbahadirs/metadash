ALTER TABLE ad_accounts ADD COLUMN monthly_budget REAL;
ALTER TABLE ad_accounts ADD COLUMN budget_note TEXT;
ALTER TABLE ad_insights_daily ADD COLUMN post_engagement REAL;
ALTER TABLE ad_insights_daily ADD COLUMN page_engagement REAL;
ALTER TABLE ad_insights_daily ADD COLUMN link_clicks REAL;
