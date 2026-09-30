import { q } from '../../db/index.js';
import { upsertExternalProfile } from '../../db/queries/profiles.js';
import { upsertAccount, insertSnapshot, pickColor, markSynced } from '../../db/queries/accounts.js';
import { setAccountTags } from '../../db/queries/tags.js';
import { upsertMedia, insertSnapshotMetric } from '../../db/queries/media.js';
import { materializeLatest, interactions } from '../../analytics/engagement.js';
import { materializeDerivedSeries } from '../../analytics/derived.js';
import { fmtDate } from '../../analytics/util.js';
import { analyzeCaption } from '../../sync/caption.js';
import { BRANDS } from '../../seed/data.js';
import { tiktokKey, tiktokMediaId, PRODUCT_TYPE } from './mappers.js';

/**
 * TikTok demo data (seed/providers.js registry; own PRNG stream, so other platforms' demo data never changes).
 * Like a real TikTok account it has no native daily insights: snapshots are written the way syncs would write them and
 * the daily follower_count / views series are derived by analytics/derived.js (same code path as a real sync).
 */
const DAY = 86_400_000;
const HOUR = 3_600_000;
const DAYS = 120;
const CAPTURE_AGES = [1, 3, 6, 12, 24, 48, 96, 168, 336, 720];

/** [brandIndex (linked Instagram demo account), username, display name] */
const DEMO_ACCOUNTS = [
  [2, 'modaevi', 'Moda Evi'],
  [4, 'tatlibahce', 'Tatlı Bahçe'],
  [0, 'kahveduragi', 'Kahve Durağı'],
];
const CAPTIONS = [
  'Behind the scenes 🎬 #fyp #keşfet', 'Yeni sezon geldi! ✨ #moda', '3 adımda tarif 🍰 #tarif #fyp', 'Sabah rutini ☕ #kahve',
  'Bunu denediniz mi? 👀 #trend', 'Müşterilerimizden 💬 #yorum', 'Ekip tanıtımı 🙌 #ekip', 'Hafta sonu kampanyası 🔥 #indirim',
];

const igKeyOf = (i) => `1784${String(i).padStart(4, '0')}`;
const between = (r, a, b) => a + r() * (b - a);
const gauss = (r) => (r() + r() + r() + r() - 2) / 1.2;
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function linkInfo(brandIndex, index) {
  const linked = igKeyOf(brandIndex);
  const ig = q.get('SELECT color FROM accounts WHERE ig_id = ?', linked);
  if (!ig) return { linkedKey: null, client: BRANDS[brandIndex]?.[2] ?? null, color: pickColor(56 + index), tagIds: [] };
  const tagIds = q.all('SELECT tag_id FROM account_tags WHERE ig_id = ?', linked).map((t) => t.tag_id);
  return { linkedKey: linked, client: BRANDS[brandIndex][2], color: ig.color, tagIds };
}

/** Lifecycle captures of a video's cumulative counts, as the tiered refresh would store them. */
function writeVideo(r, mediaId, posted, final, followers, now) {
  const halfLife = between(r, 10, 60);
  const ageHours = (now - posted) / HOUR;
  let last = null;
  const capture = (age, at) => {
    const share = 1 - Math.exp(-age / halfLife);
    const values = Object.fromEntries(Object.entries(final).map(([k, v]) => [k, Math.round(v * share)]));
    for (const [metric, value] of Object.entries(values)) insertSnapshotMetric(mediaId, at, Math.floor(age), metric, value);
    last = { values, at };
  };
  for (const age of CAPTURE_AGES) if (age <= ageHours) capture(age, posted + age * HOUR);
  if (!last) capture(ageHours, now);
  materializeLatest(mediaId, { ...last.values, total_interactions: interactions(last.values) }, followers, last.at);
}

function seedAccount(r, [brandIndex, username, name], index, now) {
  const openId = `-000demo${String(index + 1).padStart(4, '0')}tiktok`;
  const key = tiktokKey(openId);
  const profileId = upsertExternalProfile({
    platform: 'tiktok', externalId: openId, label: `Demo TikTok ${name}`, appId: 'demo-tiktok',
    tokenRef: `demo:tiktok:${openId}`, tokenExpiresAt: now + DAY, scopes: ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'],
    refreshedAt: now - 3 * HOUR,
  });
  const info = linkInfo(brandIndex, index);
  upsertAccount({
    igId: key, platform: 'tiktok', externalId: openId, profileId, username, name, linkedAccountId: info.linkedKey, isTracked: true,
    biography: `${name} TikTok'ta 🎵`, clientName: info.client, color: info.color, firstSeenAt: now - DAYS * DAY,
  });
  if (info.tagIds.length) setAccountTags(key, info.tagIds);

  let followers = Math.round(between(r, 2_000, 40_000));
  const growth = between(r, 0.001, 0.008);
  let videos = 0;
  const today = new Date(now);
  for (let d = DAYS; d >= 0; d -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d, 9);
    followers = Math.max(100, Math.round(followers * (1 + growth + gauss(r) * 0.002)));
    insertSnapshot({ igId: key, date: fmtDate(day), followers, follows: 40 + index, mediaCount: videos, capturedAt: day.getTime() });
    const perDay = r() < 0.55 ? 1 : r() < 0.15 ? 2 : 0;
    for (let i = 0; i < perDay; i += 1) {
      const posted = new Date(day.getFullYear(), day.getMonth(), day.getDate(), pick(r, [11, 13, 18, 19, 20, 21, 22]), Math.floor(r() * 60)).getTime();
      if (posted > now - HOUR) continue;
      videos += 1;
      const rawId = `73${String(index + 1).padStart(2, '0')}${String(videos).padStart(6, '0')}`;
      const mediaId = tiktokMediaId(rawId);
      const caption = pick(r, CAPTIONS);
      const at = new Date(posted);
      upsertMedia({
        mediaId, externalId: rawId, igId: key, mediaType: 'VIDEO', mediaProductType: PRODUCT_TYPE, caption,
        permalink: `https://www.tiktok.com/@${username}/video/${rawId}`, postedAt: posted, postedHour: at.getHours(),
        postedWeekday: at.getDay(), ...analyzeCaption(caption), firstSeenAt: posted + HOUR, durationS: Math.round(between(r, 8, 90)),
      });
      const viral = r() < 0.06 ? between(r, 5, 25) : 1;
      const views = Math.max(80, Math.round(followers * between(r, 0.3, 1.6) * viral * (1 + gauss(r) * 0.3)));
      const likes = Math.round(views * between(r, 0.03, 0.12));
      writeVideo(r, mediaId, posted, {
        views, likes, comments: Math.round(likes * between(r, 0.01, 0.05)), shares: Math.round(likes * between(r, 0.02, 0.1)),
      }, followers, now);
    }
  }
  materializeDerivedSeries(key);
  markSynced(key, now - 3 * HOUR);
  return key;
}

/** demo.seed: three TikTok accounts (linked to Instagram demo brands when those exist). */
export function seedTikTokDemo({ now = new Date(), rng }) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  const accounts = DEMO_ACCOUNTS.map((entry, i) => seedAccount(rng, entry, i, t));
  return { accounts };
}

/**
 * demo.extendDay (demo sync): seed/index.js already wrote today's account snapshot; add one more capture for the
 * account's videos of the last 30 days and re-derive the daily series.
 */
export function extendTikTokDemoDay(key, r, date) {
  void date;
  const now = Date.now();
  const rows = q.all(
    `SELECT m.media_id, m.posted_at, l.views, l.likes, l.comments, l.shares FROM media m JOIN media_latest l ON l.media_id = m.media_id
     WHERE m.ig_id = ? AND m.posted_at > ?`,
    key, now - 30 * DAY,
  );
  const followers = q.get('SELECT followers FROM account_snapshots WHERE ig_id = ? ORDER BY date DESC LIMIT 1', key)?.followers ?? null;
  for (const m of rows) {
    const f = 1 + Math.max(0, between(r, 0.005, 0.06));
    const values = {
      views: Math.round((m.views ?? 0) * f + 5), likes: Math.round((m.likes ?? 0) * f), comments: Math.round((m.comments ?? 0) * f), shares: Math.round((m.shares ?? 0) * f),
    };
    const age = Math.floor((now - m.posted_at) / HOUR);
    for (const [metric, value] of Object.entries(values)) insertSnapshotMetric(m.media_id, now, age, metric, value);
    materializeLatest(m.media_id, { ...values, total_interactions: interactions(values) }, followers, now);
  }
  materializeDerivedSeries(key);
}
