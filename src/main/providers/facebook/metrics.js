/**
 * Facebook Page Insights metric candidates (canonical name → API names, first = preferred).
 *
 * Verified 2026-09-29 against developers.facebook.com/docs/graph-api/reference/insights, the "Page Insights API
 * Updates" blog post (2025-08-15) and third-party deprecation notes for 2026-06-15:
 *
 * CONFIRMED documented (period day/week/days_28 unless noted):
 *   page_media_view               times content was played or displayed (replaces page_impressions)
 *   page_total_media_view_unique  unique media viewers ("Viewers"; replacement for page_impressions_unique reach)
 *   page_follows                  follower total (day)             (replaces page_fans)
 *   page_daily_follows_unique     new followers
 *   page_daily_unfollows_unique   accounts that unfollowed
 *   page_post_engagements         reactions, comments, shares, clicks on posts
 *   page_views_total              Page profile views
 *   post_media_view               (lifetime) post views             (replaces post_impressions)
 *   post_total_media_view_unique  (lifetime) unique post viewers    (replaces post_impressions_unique)
 *   post_reactions_by_type_total  (lifetime) { like, love, wow, haha, sorry, anger, ... }
 *   post_clicks                   (lifetime)
 *   since/until: at most 90 days per request.
 * CONFIRMED deprecated: page_impressions*, post_impressions*, page_fans*, page_fan_adds/removes* (2025-11-15, all versions);
 *   unique reach / paid-organic-viral splits (page_impressions_unique, post_impressions_unique, …) and unique video views
 *   (2026-06-15). They are kept only as last-resort fallbacks below — Meta answers them with code 100, which the
 *   metricFallback chain turns into 'unsupported' once, then never requests them again.
 * UNVERIFIED: whether page_views_total / page_post_engagements survive future cleanups (not on any deprecation list as
 *   of 2026-09); exact error text for an invalid metric (usually "(#100) The value must be a valid insights metric",
 *   which does not name the metric — api.js isolates metrics one by one in that case). Video/reel metrics are skipped.
 */

/** Daily Page metrics (scope 'account'); stored in account_insights_daily under the canonical names. */
export const DAILY_METRICS = Object.freeze({
  views: ['page_media_view', 'page_impressions'],
  reach: ['page_total_media_view_unique', 'page_impressions_unique'],
  post_engagements: ['page_post_engagements'],
  profile_views: ['page_views_total'],
  follower_count: ['page_daily_follows_unique'],
  unfollows: ['page_daily_unfollows_unique'],
  followers_total: ['page_follows'],
});

/** Lifetime post metrics (scope 'media'). `likes` is the sum of post_reactions_by_type_total. */
export const POST_METRICS = Object.freeze({
  views: ['post_media_view', 'post_impressions'],
  reach: ['post_total_media_view_unique', 'post_impressions_unique'],
  likes: ['post_reactions_by_type_total'],
  clicks: ['post_clicks'],
});

/** Graph fields per request. */
export const PAGE_DISCOVERY_FIELDS = 'id,name,username,link,picture{url},followers_count,fan_count,tasks,instagram_business_account{id}';
export const PAGE_PROFILE_FIELDS = 'id,name,username,link,picture{url},followers_count,fan_count,about,website';
export const POST_FIELDS = 'id,message,created_time,permalink_url,full_picture,status_type,attachments{media_type,type},shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)';
export const POST_COUNT_FIELDS = 'id,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)';

/** Scopes a Page needs for insights (pages_show_list lists it; the other two read posts + insights). */
export const FACEBOOK_SCOPES = Object.freeze(['pages_show_list', 'pages_read_engagement', 'read_insights']);

export const POSTS_PAGE_SIZE = 50;
export const POSTS_MAX = 500;
