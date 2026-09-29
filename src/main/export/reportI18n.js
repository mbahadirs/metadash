import { docTranslator } from '../locales/catalog.js';

/** Headings and labels for HTML/XLSX reports live in src/main/locales/<lang>/report.json (English fills gaps). */

/** KPI key (accountAnalytics kpis) → label key; Facebook calls reach "Viewers" and profile views "Page views". */
const KPI_LABEL = {
  reach: (p) => (p === 'facebook' ? 'viewers' : 'reach'), views: 'views', profileViews: (p) => (p === 'facebook' ? 'page_views' : 'profile_views'),
  er: 'er', saveRate: 'save_rate', newFollowers: 'new_followers', posts: 'posts', postEngagements: 'post_engagements',
  likes: 'likes', replies: 'replies', reposts: 'reposts', quotes: 'quotes', linkClicks: 'link_clicks', engaged: 'engaged',
};
/** Daily metric (account_insights_daily name) → label key. */
const METRIC_LABEL = {
  reach: KPI_LABEL.reach, views: 'views', profile_views: KPI_LABEL.profileViews, accounts_engaged: 'engaged', post_engagements: 'post_engagements',
  likes: 'likes', replies: 'replies', reposts: 'reposts', quotes: 'quotes', link_clicks: 'link_clicks', unfollows: 'unfollows', follower_count: 'new_followers',
};
const resolve = (map, key, platform) => { const v = map[key]; return typeof v === 'function' ? v(platform) : v ?? key; };
export const kpiLabelKey = (key, platform = 'instagram') => resolve(KPI_LABEL, key, platform);
export const metricLabelKey = (metric, platform = 'instagram') => resolve(METRIC_LABEL, metric, platform);

export function makeL(lang = 'en') {
  return docTranslator(lang, 'report');
}

/** Short weekday names, Sunday first. */
export const weekdays = (lang) => makeL(lang)('weekdays').split(',');
