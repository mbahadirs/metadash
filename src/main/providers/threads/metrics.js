/**
 * Threads metric names (canonical → API name). Canonical names are what MetaDash stores
 * (media_insight_snapshots / media_latest for posts, account_insights_daily for the account).
 */

/** GET /{media-id}/insights — lifetime values. `replies` is stored as `comments` so post tables line up with IG/FB. */
export const MEDIA_METRICS = Object.freeze({
  views: 'views',
  likes: 'likes',
  comments: 'replies',
  reposts: 'reposts',
  quotes: 'quotes',
  shares: 'shares',
});

/** GET /{user-id}/threads_insights — returned as a daily time series. */
export const DAILY_SERIES_METRICS = Object.freeze({ views: 'views' });

/** GET /{user-id}/threads_insights — total_value only (clicks: link_total_values); fetched one day at a time. */
export const DAILY_TOTAL_METRICS = Object.freeze({
  likes: 'likes',
  replies: 'replies',
  reposts: 'reposts',
  quotes: 'quotes',
  link_clicks: 'clicks',
});

/** follower_demographics accepts exactly one breakdown per call. Stored dimension name = breakdown. */
export const DEMOGRAPHIC_BREAKDOWNS = Object.freeze(['age', 'gender', 'country', 'city']);

/** Threads only returns follower_demographics for profiles with at least this many followers. */
export const DEMOGRAPHICS_MIN_FOLLOWERS = 100;
