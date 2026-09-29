import { portfolio, leaderboard } from '../analytics/portfolio.js';
import { accountAnalytics, accountStories, accountDemographics } from '../analytics/account.js';
import { compare } from '../analytics/compare.js';
import { bestTime } from '../analytics/besttime.js';
import { lifecycle } from '../analytics/lifecycle.js';
import { healthScores } from '../analytics/health.js';
import { anomalies } from '../analytics/anomaly.js';
import { weeklyDigest } from '../analytics/weeklyDigest.js';
import { METRIC_DEFINITIONS } from '../analytics/engagement.js';
import { listMedia } from '../db/queries/media.js';
import { mediaDetail, contentAnalysis, comparePosts } from '../analytics/content.js';
import { rangeMs } from '../analytics/util.js';
import { normalizePlatforms } from '../analytics/platform.js';
import { msg, currentLang } from '../i18n.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function assertRange(p) {
  if (!DATE.test(p?.from ?? '') || !DATE.test(p?.to ?? '')) throw new Error(msg('invalid_range'));
  if (p.from > p.to) throw new Error(msg('range_order'));
}

/** Validated copy of the payload with `platforms` normalised (undefined = all platforms). */
const withPlatforms = (p) => ({ ...p, platforms: normalizePlatforms(p?.platforms) });

export function registerAnalyticsHandlers(handle) {
  handle('analytics:portfolio', (p) => { assertRange(p); return portfolio(withPlatforms(p)); });
  handle('analytics:account', (p) => { assertRange(p); return accountAnalytics(p); });
  handle('analytics:compare', (p) => { assertRange(p); return compare(p); });
  handle('analytics:content', (p) => {
    assertRange(p);
    const { fromMs, toMs } = rangeMs(p.from, p.to);
    const f = p.filters ?? {};
    const platforms = normalizePlatforms(p.platforms ?? f.platforms);
    return listMedia({ igIds: p.igIds, from: fromMs, to: toMs, types: f.types, typeKeys: f.typeKeys, hashtag: f.hashtag, minReach: f.minReach, search: f.search, onlyPaid: f.onlyPaid, platforms, sort: f.sort ?? 'date', limit: f.limit ?? 2000 });
  });
  handle('analytics:media', (mediaId) => mediaDetail(mediaId));
  handle('analytics:comparePosts', (p) => comparePosts(p));
  handle('analytics:contentAnalysis', (p) => { assertRange(p); return contentAnalysis(withPlatforms(p)); });
  handle('analytics:bestTime', (p) => { assertRange(p); return bestTime(p); });
  handle('analytics:lifecycle', (p) => { assertRange(p); return lifecycle(p); });
  handle('analytics:demographics', (p) => accountDemographics(p));
  handle('analytics:stories', (p) => { assertRange(p); return accountStories(p); });
  handle('analytics:health', (p) => { assertRange(p); return healthScores(withPlatforms(p)); });
  handle('analytics:anomalies', (p) => { assertRange(p); return anomalies(withPlatforms(p)); });
  handle('analytics:weeklyDigest', (p = {}) => weeklyDigest({ ...withPlatforms(p), lang: p.lang ?? currentLang() }));
  handle('analytics:leaderboard', (p) => { assertRange(p); return leaderboard(withPlatforms(p)); });
  handle('analytics:definitions', () => METRIC_DEFINITIONS);
}
