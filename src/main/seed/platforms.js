import { subDays } from 'date-fns';
import { q } from '../db/index.js';
import { upsertAccount, insertSnapshot, upsertInsightDaily, upsertDemographic, pickColor, markSynced } from '../db/queries/accounts.js';
import { findOrCreateTag, setAccountTags } from '../db/queries/tags.js';
import { upsertMedia, insertSnapshotMetric } from '../db/queries/media.js';
import { materializeLatest, interactions } from '../analytics/engagement.js';
import { fmtDate } from '../analytics/util.js';
import { analyzeCaption } from '../sync/caption.js';
import { accountKeyFor } from '../providers/capabilities.js';
import { rng, pick, between, gauss } from './random.js';
import { BRANDS, FB_PAGES, THREADS_PROFILES, FB_CAPTIONS, THREADS_TEXTS, THREADS_AGE_BUCKETS, THREADS_GENDERS, CITIES, COUNTRIES } from './data.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const DAYS = 120;
const CAPTURE_AGES = [1, 3, 6, 12, 24, 48, 96, 168, 336, 720];
const FB_SEED = 20251115;
const THREADS_SEED = 20240413;

export const PLATFORM_DEMO_COUNTS = Object.freeze({ facebook: FB_PAGES.length, threads: THREADS_PROFILES.length });

const igKeyOf = (brandIndex) => `1784${String(brandIndex).padStart(4, '0')}`;

/** Client/sector/colour/tags inherited from the linked Instagram account (or the entry's own values). */
function linkInfo([brandIndex, , , client, sector], fallbackColorIndex) {
  if (brandIndex == null) return { linkedKey: null, client, sector, color: pickColor(fallbackColorIndex), tagIds: [] };
  const linkedKey = igKeyOf(brandIndex);
  const ig = q.get('SELECT color FROM accounts WHERE ig_id = ?', linkedKey);
  const tagIds = q.all('SELECT tag_id FROM account_tags WHERE ig_id = ?', linkedKey).map((t) => t.tag_id);
  return { linkedKey, client: BRANDS[brandIndex][2], sector: BRANDS[brandIndex][3], color: ig?.color ?? pickColor(fallbackColorIndex), tagIds };
}

function igFollowers(key) {
  return key ? q.get('SELECT followers FROM account_snapshots WHERE ig_id = ? ORDER BY date DESC LIMIT 1', key)?.followers ?? null : null;
}

function tagsFor(info) {
  if (info.tagIds.length || !info.sector) return info.tagIds;
  return [findOrCreateTag(info.sector, pickColor(BRANDS.length)).id];
}

/** Writes lifecycle snapshots (share of the final value by post age) and media_latest for one post. */
function writePostMetrics(r, mediaId, posted, final, followers, now, halfLifeRange) {
  const ageHours = (now.getTime() - posted.getTime()) / HOUR;
  const halfLife = between(r, halfLifeRange[0], halfLifeRange[1]);
  const scaled = (share) => Object.fromEntries(Object.entries(final).map(([k, v]) => [k, Math.round(v * share)]));
  let last = null;
  for (const age of CAPTURE_AGES) {
    if (age > ageHours) break;
    const capturedAt = posted.getTime() + age * HOUR;
    const values = scaled(1 - Math.exp(-age / halfLife));
    for (const [metric, value] of Object.entries(values)) insertSnapshotMetric(mediaId, capturedAt, age, metric, value);
    last = { values, capturedAt };
  }
  if (!last) {
    const values = scaled(1 - Math.exp(-ageHours / halfLife));
    for (const [metric, value] of Object.entries(values)) insertSnapshotMetric(mediaId, now.getTime(), Math.floor(ageHours), metric, value);
    last = { values, capturedAt: now.getTime() };
  }
  materializeLatest(mediaId, { ...last.values, total_interactions: interactions(last.values) }, followers, last.capturedAt);
}

function postTime(r, now, ageDays, hours) {
  const d = subDays(now, Math.floor(ageDays));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), pick(r, hours), Math.floor(r() * 60));
}

// ---------- Facebook Pages ----------

function seedFacebookPage(r, entry, index, { profileId, now }) {
  const externalId = `10000000000000${String(index + 1).padStart(2, '0')}`;
  const key = accountKeyFor('facebook', externalId);
  const [, username, name] = entry;
  const info = linkInfo(entry, 40 + index);
  const base = Math.round((igFollowers(info.linkedKey) ?? between(r, 4000, 60_000)) * between(r, 0.4, 1.6));
  const growth = between(r, -0.0003, 0.0025);
  const reachRatio = between(r, 0.04, 0.22);
  const erBase = between(r, 0.6, 3.2) / 100;
  upsertAccount({ igId: key, platform: 'facebook', externalId, linkedAccountId: info.linkedKey, isTracked: true, profileId, pageId: externalId, username, name, biography: `${name} resmî Facebook sayfası.`, website: `https://${username.toLowerCase().replace(/[^a-z0-9]/g, '')}.com.tr`, clientName: info.client, color: info.color, firstSeenAt: Date.now() - DAYS * DAY });
  setAccountTags(key, tagsFor(info));
  markSynced(key, Date.now() - 3 * HOUR);

  let followers = base;
  for (let d = DAYS; d >= 0; d -= 1) {
    const day = subDays(now, d);
    const date = fmtDate(day);
    const weekend = day.getDay() === 0 || day.getDay() === 6 ? 1.15 : 1;
    const newFollows = Math.max(0, Math.round(followers * Math.max(growth, 0) + between(r, 0, 10)));
    const unfollows = Math.max(0, Math.round(followers * Math.max(-growth, 0) + between(r, 0, 5)));
    followers = Math.max(50, followers + newFollows - unfollows);
    insertSnapshot({ igId: key, date, followers, follows: 0, mediaCount: Math.round(500 + (DAYS - d) * 0.4), capturedAt: day.getTime() });
    const reach = Math.max(30, Math.round(followers * reachRatio * weekend * (1 + gauss(r) * 0.25)));
    upsertInsightDaily(key, date, 'reach', reach);
    upsertInsightDaily(key, date, 'views', Math.round(reach * between(r, 1.3, 2.2)));
    upsertInsightDaily(key, date, 'post_engagements', Math.round(reach * between(r, 0.02, 0.08)));
    upsertInsightDaily(key, date, 'profile_views', Math.round(reach * between(r, 0.01, 0.04)));
    upsertInsightDaily(key, date, 'follower_count', newFollows);
    upsertInsightDaily(key, date, 'unfollows', unfollows);
  }

  const total = Math.round((DAYS * between(r, 1.2, 4)) / 7);
  for (let i = 0; i < total; i += 1) {
    const ageDays = (i / total) * DAYS + between(r, 0, 2);
    if (ageDays > DAYS) continue;
    const posted = postTime(r, now, ageDays, [9, 10, 12, 13, 17, 19, 20]);
    if (posted.getTime() > now.getTime() - HOUR) continue;
    const roll = r();
    const mediaType = roll < 0.4 ? 'IMAGE' : roll < 0.6 ? 'VIDEO' : roll < 0.85 ? 'LINK' : 'TEXT';
    const mediaId = `${externalId}_${String(i).padStart(3, '0')}`;
    const caption = pick(r, FB_CAPTIONS);
    upsertMedia({ mediaId, externalId: mediaId, igId: key, mediaType, mediaProductType: 'FB_POST', caption, permalink: `https://www.facebook.com/${externalId}/posts/${i}`, postedAt: posted.getTime(), postedHour: posted.getHours(), postedWeekday: posted.getDay(), ...analyzeCaption(caption), firstSeenAt: posted.getTime() + HOUR });
    const typeBonus = mediaType === 'VIDEO' ? 1.5 : mediaType === 'IMAGE' ? 1.15 : 1;
    const viral = r() < 0.04 ? between(r, 3, 7) : 1;
    const reach = Math.max(40, Math.round(followers * reachRatio * 1.4 * typeBonus * viral * (1 + gauss(r) * 0.3)));
    const likes = Math.round(reach * erBase * (1 + gauss(r) * 0.3) * 3);
    writePostMetrics(r, mediaId, posted, {
      reach,
      views: Math.round(reach * between(r, 1.1, 1.6)),
      likes: Math.max(0, likes),
      comments: Math.max(0, Math.round(likes * between(r, 0.04, 0.12))),
      shares: Math.max(0, Math.round(likes * between(r, 0.05, 0.15))),
      clicks: Math.round(reach * (mediaType === 'LINK' ? between(r, 0.02, 0.06) : between(r, 0.003, 0.012))),
    }, followers, now, [5, 16]);
  }
  return key;
}

// ---------- Threads ----------

function seedThreadsProfile(r, entry, index, { profileId, now }) {
  const externalId = `25000000000000${String(index + 1).padStart(2, '0')}`;
  const key = accountKeyFor('threads', externalId);
  const [, username, name] = entry;
  const info = linkInfo(entry, 48 + index);
  const base = Math.round((igFollowers(info.linkedKey) ?? between(r, 800, 12_000)) * between(r, 0.08, 0.35)) + 150;
  const growth = between(r, 0.0005, 0.006);
  const viewRatio = between(r, 0.3, 1.4);
  upsertAccount({ igId: key, platform: 'threads', externalId, linkedAccountId: info.linkedKey, isTracked: true, profileId, username, name, biography: `${name} Threads'te.`, clientName: info.client, color: info.color, firstSeenAt: Date.now() - DAYS * DAY });
  setAccountTags(key, tagsFor(info));
  markSynced(key, Date.now() - 3 * HOUR);

  let followers = base;
  for (let d = DAYS; d >= 0; d -= 1) {
    const day = subDays(now, d);
    const date = fmtDate(day);
    followers = Math.max(20, Math.round(followers * (1 + growth) + gauss(r) * base * 0.002));
    insertSnapshot({ igId: key, date, followers, follows: Math.round(base * 0.1), mediaCount: Math.round(80 + (DAYS - d) * 0.6), capturedAt: day.getTime() });
    const spike = d === 1 && index === 1 ? 4 : 1;
    const views = Math.max(20, Math.round(followers * viewRatio * spike * (1 + gauss(r) * 0.3)));
    const likes = Math.round(views * between(r, 0.01, 0.03));
    upsertInsightDaily(key, date, 'views', views);
    upsertInsightDaily(key, date, 'likes', likes);
    upsertInsightDaily(key, date, 'replies', Math.round(likes * between(r, 0.1, 0.25)));
    upsertInsightDaily(key, date, 'reposts', Math.round(likes * between(r, 0.05, 0.12)));
    upsertInsightDaily(key, date, 'quotes', Math.round(likes * between(r, 0.02, 0.05)));
    upsertInsightDaily(key, date, 'link_clicks', Math.round(views * between(r, 0.001, 0.004)));
  }

  const total = Math.round((DAYS * between(r, 3, 8)) / 7);
  for (let i = 0; i < total; i += 1) {
    const ageDays = (i / total) * DAYS + between(r, 0, 1.5);
    if (ageDays > DAYS) continue;
    const posted = postTime(r, now, ageDays, [8, 9, 12, 13, 18, 21, 22]);
    if (posted.getTime() > now.getTime() - HOUR) continue;
    const roll = r();
    const mediaType = roll < 0.6 ? 'TEXT_POST' : roll < 0.85 ? 'IMAGE' : 'CAROUSEL_ALBUM';
    const rawId = `18${String(index + 1).padStart(2, '0')}${String(i).padStart(5, '0')}`;
    const mediaId = accountKeyFor('threads', rawId);
    const caption = pick(r, THREADS_TEXTS);
    upsertMedia({ mediaId, externalId: rawId, igId: key, mediaType, mediaProductType: 'THREADS', caption, permalink: `https://www.threads.net/@${username}/post/${rawId}`, postedAt: posted.getTime(), postedHour: posted.getHours(), postedWeekday: posted.getDay(), ...analyzeCaption(caption), firstSeenAt: posted.getTime() + HOUR });
    const viral = r() < 0.05 ? between(r, 3, 10) : 1;
    const views = Math.max(15, Math.round(followers * viewRatio * 0.8 * viral * (mediaType === 'TEXT_POST' ? 1 : 1.2) * (1 + gauss(r) * 0.35)));
    const likes = Math.max(0, Math.round(views * between(r, 0.01, 0.05)));
    writePostMetrics(r, mediaId, posted, {
      views,
      likes,
      comments: Math.round(likes * between(r, 0.08, 0.25)),
      reposts: Math.round(likes * between(r, 0.04, 0.12)),
      quotes: Math.round(likes * between(r, 0.01, 0.05)),
      shares: Math.round(likes * between(r, 0.02, 0.06)),
    }, followers, now, [3, 12]);
  }

  // follower demographics (Threads: separate age / gender / country / city breakdowns)
  const capturedAt = Date.now() - Math.floor(between(r, 0, 6)) * DAY;
  const ageWeights = [0.24, 0.36, 0.2, 0.11, 0.06, 0.03];
  THREADS_AGE_BUCKETS.forEach((b, i) => upsertDemographic(key, capturedAt, 'age', b, Math.round(followers * ageWeights[i])));
  const female = between(r, 0.35, 0.65);
  [female, (1 - female) * 0.95, (1 - female) * 0.05].forEach((w, i) => upsertDemographic(key, capturedAt, 'gender', THREADS_GENDERS[i], Math.round(followers * w)));
  const countryWeights = [0.78, 0.07, 0.04, 0.04, 0.03, 0.02, 0.02];
  COUNTRIES.forEach((c, i) => upsertDemographic(key, capturedAt, 'country', c, Math.round(followers * countryWeights[i])));
  const cityWeights = CITIES.map(() => r()).sort((a, b) => b - a);
  const citySum = cityWeights.reduce((a, b) => a + b, 0);
  CITIES.forEach((c, i) => upsertDemographic(key, capturedAt, 'city', c, Math.round((cityWeights[i] / citySum) * followers * 0.8)));
  return key;
}

/**
 * Seeds the demo Facebook Pages (Meta profile) and Threads profiles (demo Threads profile). Uses its own PRNG streams
 * and runs after the Instagram seed, so the 40 Instagram accounts are byte-for-byte unchanged.
 */
export function seedPlatformAccounts({ metaProfileId, threadsProfileId, now = new Date(), onProgress } = {}) {
  const fbR = rng(FB_SEED);
  const facebook = FB_PAGES.map((entry, i) => {
    onProgress?.(`Facebook Page ${i + 1}/${FB_PAGES.length}: ${entry[2]}`);
    return seedFacebookPage(fbR, entry, i, { profileId: metaProfileId, now });
  });
  const thR = rng(THREADS_SEED);
  const threads = THREADS_PROFILES.map((entry, i) => {
    onProgress?.(`Threads ${i + 1}/${THREADS_PROFILES.length}: @${entry[1]}`);
    return seedThreadsProfile(thR, entry, i, { profileId: threadsProfileId, now });
  });
  return { facebook, threads };
}

const lastMetric = (key, metric) => q.get('SELECT value FROM account_insights_daily WHERE ig_id = ? AND metric = ? ORDER BY date DESC LIMIT 1', key, metric)?.value;

/** One more demo day for a Facebook Page or Threads profile (Instagram is handled in seed/index.js). */
export function extendPlatformDay(key, platform, r, date) {
  if (platform === 'facebook') {
    const reach = Math.round((lastMetric(key, 'reach') ?? 500) * (1 + gauss(r) * 0.2));
    upsertInsightDaily(key, date, 'reach', reach);
    upsertInsightDaily(key, date, 'views', Math.round(reach * 1.7));
    upsertInsightDaily(key, date, 'post_engagements', Math.round(reach * 0.05));
    upsertInsightDaily(key, date, 'profile_views', Math.round(reach * 0.025));
    return;
  }
  if (platform === 'threads') {
    const views = Math.round((lastMetric(key, 'views') ?? 500) * (1 + gauss(r) * 0.25));
    const likes = Math.round(views * 0.02);
    upsertInsightDaily(key, date, 'views', views);
    upsertInsightDaily(key, date, 'likes', likes);
    upsertInsightDaily(key, date, 'replies', Math.round(likes * 0.18));
    upsertInsightDaily(key, date, 'reposts', Math.round(likes * 0.08));
    upsertInsightDaily(key, date, 'quotes', Math.round(likes * 0.03));
    upsertInsightDaily(key, date, 'link_clicks', Math.round(views * 0.002));
  }
}
