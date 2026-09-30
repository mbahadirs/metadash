import { subDays } from 'date-fns';
import { q } from '../../db/index.js';
import { upsertExternalProfile } from '../../db/queries/profiles.js';
import { upsertAccount, insertSnapshot, upsertInsightDaily, upsertDemographic, markSynced, pickColor } from '../../db/queries/accounts.js';
import { setAccountTags } from '../../db/queries/tags.js';
import { upsertMedia, insertSnapshotMetric } from '../../db/queries/media.js';
import { materializeLatest, interactions } from '../../analytics/engagement.js';
import { fmtDate } from '../../analytics/util.js';
import { analyzeCaption } from '../../sync/caption.js';
import { BRANDS, COUNTRIES, AGE_BUCKETS } from '../../seed/data.js';
import { BASE_SCOPES } from './auth.js';
import { accountKey, videoKey } from './mappers.js';

/**
 * Demo data for the provider demo registry (seed/providers.js): two channels linked to Instagram demo brands, each
 * with its own demo profile (token_ref 'demo:google:<channelId>'), 120 days of daily Analytics series, Shorts /
 * videos / live streams with watch-time metrics, and viewer demographics.
 */
const DAY = 86_400_000;
const HOUR = 3_600_000;
const DAYS = 120;
const CAPTURE_AGES = [1, 3, 6, 12, 24, 48, 96, 168, 336, 720];
export const DEMO_CLIENT_ID = 'demo-client.apps.googleusercontent.com';

/** [brand index, channel id, title, handle] */
export const DEMO_CHANNELS = Object.freeze([
  [0, 'UCdemoKahveDuragi0000001', 'Kahve Durağı TV', '@kahveduragitv'],
  [3, 'UCdemoBisikletciIst00002', 'Bisikletçi İstanbul', '@bisikletciistanbul'],
]);

const TITLES = Object.freeze([
  ['Sabah rutini: 3 dakikada filtre kahve', 'SHORT'], ['Ekipman incelemesi — tüm detaylar', 'VIDEO'], ['Soru-cevap canlı yayını', 'LIVE'],
  ['Yeni sezon tanıtımı #shorts', 'SHORT'], ['Adım adım rehber: başlangıç seviyesi', 'VIDEO'], ['Perde arkası #shorts', 'SHORT'],
  ['Müşteri hikayeleri', 'VIDEO'], ['30 saniyede ipucu #shorts', 'SHORT'],
]);

const between = (r, a, b) => a + r() * (b - a);
const gauss = (r) => (r() + r() + r() + r() - 2) / 1.2;
const pickFrom = (r, arr) => arr[Math.floor(r() * arr.length)];

function linkedIg(brandIndex) {
  const key = `1784${String(brandIndex).padStart(4, '0')}`;
  const row = q.get('SELECT color FROM accounts WHERE ig_id = ?', key);
  if (!row) return { linkedKey: null, color: null, tagIds: [] };
  return { linkedKey: key, color: row.color, tagIds: q.all('SELECT tag_id FROM account_tags WHERE ig_id = ?', key).map((t) => t.tag_id) };
}

function seedVideo(r, { key, channelIndex, i, total, now, subscribers }) {
  const ageDays = (i / total) * DAYS + between(r, 0, 1.5);
  if (ageDays > DAYS) return;
  const d = subDays(now, Math.floor(ageDays));
  const posted = new Date(d.getFullYear(), d.getMonth(), d.getDate(), pickFrom(r, [11, 14, 17, 19, 20, 21]), Math.floor(r() * 60));
  if (posted.getTime() > now.getTime() - HOUR) return;
  const [title, kind] = TITLES[(i + channelIndex * 3) % TITLES.length];
  const type = kind === 'SHORT' ? 'YT_SHORT' : kind === 'LIVE' ? 'YT_LIVE' : 'YT_VIDEO';
  const durationS = type === 'YT_SHORT' ? Math.round(between(r, 15, 170)) : type === 'YT_LIVE' ? Math.round(between(r, 1800, 5400)) : Math.round(between(r, 240, 1500));
  const videoId = `dm${channelIndex}${String(i).padStart(5, '0')}yt`;
  const mediaId = videoKey(videoId);
  const caption = `${title}\n${BRANDS[DEMO_CHANNELS[channelIndex][0]][1]} — demo`;
  upsertMedia({
    mediaId, externalId: videoId, igId: key, mediaType: 'VIDEO', mediaProductType: type, caption, permalink: `https://youtu.be/${videoId}`,
    postedAt: posted.getTime(), postedHour: posted.getHours(), postedWeekday: posted.getDay(), ...analyzeCaption(caption), firstSeenAt: posted.getTime() + HOUR, durationS,
  });
  const viral = r() < 0.05 ? between(r, 3, 9) : 1;
  const views = Math.max(40, Math.round(subscribers * (type === 'YT_SHORT' ? between(r, 0.3, 1.6) : between(r, 0.08, 0.45)) * viral * (1 + gauss(r) * 0.25)));
  const likes = Math.round(views * between(r, 0.02, 0.06));
  const avgPct = type === 'YT_SHORT' ? between(r, 55, 95) : type === 'YT_LIVE' ? between(r, 8, 22) : between(r, 30, 55);
  const avgDur = Math.round((durationS * avgPct) / 100);
  const final = { views, likes, comments: Math.round(likes * between(r, 0.03, 0.12)), shares: Math.round(likes * between(r, 0.02, 0.08)), watch_time_min: Math.round((views * avgDur) / 60) };
  const ageHours = (now.getTime() - posted.getTime()) / HOUR;
  const halfLife = between(r, 12, 60);
  let last = null;
  for (const age of CAPTURE_AGES) {
    if (age > ageHours) break;
    const share = 1 - Math.exp(-age / halfLife);
    const values = Object.fromEntries(Object.entries(final).map(([k, v]) => [k, Math.round(v * share)]));
    for (const [metric, value] of Object.entries(values)) insertSnapshotMetric(mediaId, posted.getTime() + age * HOUR, age, metric, value);
    last = { values, at: posted.getTime() + age * HOUR };
  }
  if (!last) last = { values: Object.fromEntries(Object.entries(final).map(([k, v]) => [k, Math.round(v * 0.1)])), at: now.getTime() };
  materializeLatest(mediaId, { ...last.values, avg_view_duration_s: avgDur, avg_view_pct: Math.round(avgPct * 10) / 10, total_interactions: interactions(last.values) }, subscribers, last.at);
}

function seedChannel(r, [brandIndex, channelId, title, handle], channelIndex, { now }) {
  const key = accountKey(channelId);
  const link = linkedIg(brandIndex);
  const profileId = upsertExternalProfile({
    platform: 'google', externalId: channelId, label: title, appId: DEMO_CLIENT_ID, tokenRef: `demo:google:${channelId}`,
    tokenExpiresAt: now.getTime() + HOUR, scopes: BASE_SCOPES, refreshedAt: now.getTime() - HOUR,
  });
  upsertAccount({
    igId: key, platform: 'youtube', externalId: channelId, linkedAccountId: link.linkedKey, isTracked: true, profileId, username: handle.replace(/^@/, ''), name: title,
    biography: `${title} resmî YouTube kanalı.`, website: `https://www.youtube.com/${handle}`, clientName: BRANDS[brandIndex][2],
    color: link.color ?? pickColor(56 + channelIndex), firstSeenAt: now.getTime() - DAYS * DAY,
  });
  if (link.tagIds.length) setAccountTags(key, link.tagIds);
  markSynced(key, now.getTime() - 3 * HOUR);

  let subscribers = Math.round(between(r, 3000, 60_000));
  const growth = between(r, 0.0008, 0.004);
  for (let d = DAYS; d >= 0; d -= 1) {
    const day = subDays(now, d);
    const date = fmtDate(day);
    const gained = Math.max(0, Math.round(subscribers * growth + between(r, 0, 12)));
    const lost = Math.max(0, Math.round(gained * between(r, 0.1, 0.35)));
    subscribers += gained - lost;
    insertSnapshot({ igId: key, date, followers: subscribers, follows: 0, mediaCount: Math.round(140 + (DAYS - d) * 0.5), capturedAt: day.getTime() });
    if (d < 2) continue; // Analytics lags ~2 days
    const weekend = day.getDay() === 0 || day.getDay() === 6 ? 1.2 : 1;
    const views = Math.max(80, Math.round(subscribers * between(r, 0.15, 0.4) * weekend * (1 + gauss(r) * 0.2)));
    const avgDur = Math.round(between(r, 70, 260));
    const likes = Math.round(views * between(r, 0.02, 0.05));
    upsertInsightDaily(key, date, 'views', views);
    upsertInsightDaily(key, date, 'watch_time_min', Math.round((views * avgDur) / 60));
    upsertInsightDaily(key, date, 'avg_view_duration_s', avgDur);
    upsertInsightDaily(key, date, 'likes', likes);
    upsertInsightDaily(key, date, 'comments', Math.round(likes * between(r, 0.05, 0.15)));
    upsertInsightDaily(key, date, 'shares', Math.round(likes * between(r, 0.03, 0.1)));
    upsertInsightDaily(key, date, 'follower_count', gained);
    upsertInsightDaily(key, date, 'unfollows', lost);
  }

  const total = Math.round((DAYS * between(r, 3, 6)) / 7);
  for (let i = 0; i < total; i += 1) seedVideo(r, { key, channelIndex, i, total, now, subscribers });

  const capturedAt = now.getTime() - Math.floor(between(r, 0, 6)) * DAY;
  const ageWeights = [0.04, 0.22, 0.34, 0.2, 0.11, 0.06, 0.03];
  const female = between(r, 0.3, 0.6);
  AGE_BUCKETS.forEach((b, i) => {
    upsertDemographic(key, capturedAt, 'gender_age', `F.${b}`, Math.round(ageWeights[i] * female * 1000) / 10);
    upsertDemographic(key, capturedAt, 'gender_age', `M.${b}`, Math.round(ageWeights[i] * (1 - female) * 1000) / 10);
  });
  const countryWeights = [0.72, 0.08, 0.05, 0.05, 0.05, 0.03, 0.02];
  COUNTRIES.forEach((c, i) => upsertDemographic(key, capturedAt, 'country', c, Math.round(subscribers * 3 * countryWeights[i])));
  return key;
}

export const youtubeDemo = {
  seed({ now = new Date(), rng }) {
    const accounts = DEMO_CHANNELS.map((c, i) => seedChannel(rng, c, i, { now }));
    return { accounts };
  },

  /** One more demo day (demo sync): today's Analytics-like values from the last stored day. */
  extendDay(key, r, date) {
    const last = (metric, fallback) => q.get('SELECT value FROM account_insights_daily WHERE ig_id = ? AND metric = ? ORDER BY date DESC LIMIT 1', key, metric)?.value ?? fallback;
    const views = Math.max(50, Math.round(last('views', 1500) * (1 + gauss(r) * 0.2)));
    const avgDur = Math.round(last('avg_view_duration_s', 150) * (1 + gauss(r) * 0.05));
    const likes = Math.round(views * 0.03);
    upsertInsightDaily(key, date, 'views', views);
    upsertInsightDaily(key, date, 'watch_time_min', Math.round((views * avgDur) / 60));
    upsertInsightDaily(key, date, 'avg_view_duration_s', avgDur);
    upsertInsightDaily(key, date, 'likes', likes);
    upsertInsightDaily(key, date, 'comments', Math.round(likes * 0.1));
    upsertInsightDaily(key, date, 'shares', Math.round(likes * 0.05));
    upsertInsightDaily(key, date, 'follower_count', Math.round(between(r, 5, 40)));
    upsertInsightDaily(key, date, 'unfollows', Math.round(between(r, 0, 8)));
  },
};
