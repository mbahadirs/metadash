/**
 * YouTube Analytics API metric names → canonical MetaDash names (account_insights_daily.metric / media_latest columns).
 * Channel "time-based" reports (dimensions=day) support every DAILY metric; the video report (dimensions=video) does
 * not support subscribersGained/Lost, so VIDEO leaves them out (developers.google.com/youtube/analytics/channel_reports).
 */
export const DAILY_METRICS = Object.freeze({
  views: 'views',
  estimatedMinutesWatched: 'watch_time_min',
  averageViewDuration: 'avg_view_duration_s',
  subscribersGained: 'follower_count',
  subscribersLost: 'unfollows',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
});

export const VIDEO_METRICS = Object.freeze({
  views: 'views',
  estimatedMinutesWatched: 'watch_time_min',
  averageViewDuration: 'avg_view_duration_s',
  averageViewPercentage: 'avg_view_pct',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
});

/** videos.list statistics → canonical (real-time counts; Analytics lags 2–3 days). */
export const STAT_METRICS = Object.freeze({ viewCount: 'views', likeCount: 'likes', commentCount: 'comments' });

/** Shorts heuristic when Analytics has no creatorContentType for a video (Shorts may be up to 3 min since Oct 2024). */
export const SHORTS_MAX_SECONDS = 180;

/** Demographic window (days) for the weekly ageGroup/gender and country reports. */
export const DEMOGRAPHICS_DAYS = 28;
