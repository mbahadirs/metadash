import { subDays, addHours } from 'date-fns';
import { getDb, q } from '../db/index.js';
import { upsertProfile } from '../db/queries/profiles.js';
import { upsertAccount, insertSnapshot, upsertInsightDaily, upsertDemographic, pickColor, markSynced } from '../db/queries/accounts.js';
import { findOrCreateTag, setAccountTags } from '../db/queries/tags.js';
import { upsertMedia, insertSnapshotMetric, upsertComment } from '../db/queries/media.js';
import { upsertStory } from '../db/queries/stories.js';
import { upsertAdAccount, upsertAdInsight, upsertAdBreakdown, upsertAdMediaLink } from '../db/queries/ads.js';
import { addCompetitor, upsertCompetitorSnapshot } from '../db/queries/competitors.js';
import { createRun, updateRun } from '../db/queries/sync.js';
import { setSetting } from '../db/queries/settings.js';
import { materializeLatest } from '../analytics/engagement.js';
import { fmtDate } from '../analytics/util.js';
import { analyzeCaption } from '../sync/caption.js';
import { BRANDS, CAPTIONS, CITIES, COUNTRIES, AGE_BUCKETS, COMPETITOR_NAMES, COMMENTERS, COMMENT_TEXTS, CAMPAIGN_NAMES, ADSET_NAMES, AD_NAMES } from './data.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const DAYS = 120;
const CAPTURE_AGES = [1, 3, 6, 12, 24, 48, 96, 168, 336, 720];

/** Deterministic PRNG so the demo looks the same on every machine. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const between = (r, a, b) => a + r() * (b - a);
const gauss = (r) => (r() + r() + r() + r() - 2) / 1.2;

export function isSeeded() {
  return !!q.get("SELECT 1 FROM profiles WHERE token_ref LIKE 'demo%' LIMIT 1");
}

/** Demo data may only be loaded when no real Meta connection exists (it would mix fake and real accounts). */
export function canLoadDemo() {
  return !q.get("SELECT 1 FROM profiles WHERE token_ref NOT LIKE 'demo%' LIMIT 1");
}

export function clearAll() {
  const db = getDb();
  const tables = ['sync_errors', 'sync_runs', 'notes', 'ad_insights_breakdown', 'ad_insights_daily', 'ad_media_links', 'ad_budget_overrides', 'ad_accounts', 'competitor_snapshots', 'competitors', 'comments', 'stories', 'media_latest', 'media_insight_snapshots', 'media', 'account_demographics', 'account_insights_daily', 'account_snapshots', 'account_tags', 'tags', 'accounts', 'profiles', 'disabled_metrics'];
  db.transaction(() => { for (const t of tables) db.exec(`DELETE FROM ${t}`); })();
}

/** Seeds the database as if 40 accounts had been connected and synced for 120 days. */
export function seedDemo({ reset = false, onProgress } = {}) {
  const db = getDb();
  if (reset) clearAll();
  if (isSeeded()) return { skipped: true };
  const started = Date.now();
  const now = new Date();
  const today = fmtDate(now);
  const r = rng(20240905);
  const report = (msg) => onProgress?.(msg);

  const profileId = upsertProfile({ label: 'Demo Business Manager', appId: '123456789012345', tokenRef: 'demo', tokenExpiresAt: Date.now() + 55 * DAY });
  const sectorTags = new Map();
  const vipTag = findOrCreateTag('VIP client', '#E8B44A');
  const newTag = findOrCreateTag('New client', '#3FBF8F');

  db.transaction(() => {
    BRANDS.forEach((b, i) => {
      report(`Account ${i + 1}/40: @${b[0]}`);
      seedAccount(r, { index: i, username: b[0], name: b[1], client: b[2], sector: b[3], profileId, now, today });
      const tag = sectorTags.get(b[3]) ?? findOrCreateTag(b[3], pickColor(sectorTags.size));
      sectorTags.set(b[3], tag);
      const tags = [tag.id];
      if (i % 7 === 0) tags.push(vipTag.id);
      if (i % 11 === 3) tags.push(newTag.id);
      setAccountTags(`1784${String(i).padStart(4, '0')}`, tags);
    });
  })();

  report('Ad accounts');
  db.transaction(() => seedAds(r, profileId, today))();
  report('Competitors');
  db.transaction(() => seedCompetitors(r, today))();
  report('Sync history');
  db.transaction(() => {
    for (let d = 6; d >= 0; d -= 1) {
      const at = Date.now() - d * DAY - 3 * HOUR;
      const id = createRun(d % 3 === 0 ? 'full' : d % 3 === 1 ? 'organic' : 'stories', 40);
      updateRun(id, { finishedAt: at + 4 * 60_000, status: 'ok', accountsDone: 40, apiCalls: 1200 + Math.round(r() * 300), errorSummary: 'Demo mode: sample run' });
      q.run('UPDATE sync_runs SET started_at = ? WHERE id = ?', at, id);
    }
  })();
  setSetting('setupStep', 6);
  setSetting('setupComplete', true);
  setSetting('demoMode', true);
  return { skipped: false, ms: Date.now() - started, accounts: BRANDS.length };
}

function seedAccount(r, { index, username, name, client, sector, profileId, now, today }) {
  const igId = `1784${String(index).padStart(4, '0')}`;
  const base = Math.round(between(r, 1800, 180_000));
  const growthRate = between(r, -0.0004, 0.004);
  const postsPerWeek = between(r, 1.5, 6);
  const erBase = between(r, 0.8, 5.5);
  const reachRatio = between(r, 0.15, 0.6);
  const daysSinceLastPost = index % 13 === 5 ? 9 : index % 17 === 2 ? 12 : 0;
  const biography = `${name} resmî hesabı. ${sector} alanında ${Math.round(between(r, 3, 25))} yıllık deneyim.`;

  upsertAccount({ igId, profileId, pageId: `10${igId}`, username, name, profilePicUrl: null, biography, website: `https://${username}.com.tr`, clientName: client, color: pickColor(index), firstSeenAt: Date.now() - DAYS * DAY });
  markSynced(igId, Date.now() - 3 * HOUR);

  // followers + daily insights
  let followers = base;
  const trendBoost = index % 9 === 4 ? 1.8 : 1;
  for (let d = DAYS; d >= 0; d -= 1) {
    const date = fmtDate(subDays(now, d));
    const weekday = subDays(now, d).getDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 0.85 : 1;
    followers = Math.round(followers * (1 + growthRate * (d < 20 ? trendBoost : 1)) + gauss(r) * base * 0.0015);
    insertSnapshot({ igId, date, followers, follows: Math.round(base * 0.03), mediaCount: Math.round(300 + (DAYS - d) * postsPerWeek / 7), capturedAt: subDays(now, d).getTime() });
    const spike = d === 2 && index % 8 === 1 ? 3.2 : d === 1 && index % 10 === 6 ? 0.25 : 1;
    const reach = Math.max(50, Math.round(followers * reachRatio * weekendFactor * spike * (1 + gauss(r) * 0.25)));
    upsertInsightDaily(igId, date, 'reach', reach);
    upsertInsightDaily(igId, date, 'views', Math.round(reach * between(r, 1.4, 2.6)));
    upsertInsightDaily(igId, date, 'profile_views', Math.round(reach * between(r, 0.02, 0.07)));
    upsertInsightDaily(igId, date, 'accounts_engaged', Math.round(reach * between(r, 0.04, 0.12)));
    upsertInsightDaily(igId, date, 'follower_count', Math.max(0, Math.round(followers * growthRate + between(r, 0, 12))));
  }

  // media
  const bestHours = [pick(r, [9, 12, 13, 18, 19, 20, 21]), pick(r, [11, 17, 20, 21])];
  const bestDays = [pick(r, [1, 2, 3, 4]), pick(r, [5, 6, 0])];
  const total = Math.round((DAYS * postsPerWeek) / 7);
  const ownerReplyRate = between(r, 0.1, 0.9);
  for (let i = 0; i < total; i += 1) {
    const ageDays = daysSinceLastPost + (i / total) * (DAYS - daysSinceLastPost) + between(r, 0, 2);
    if (ageDays > DAYS) continue;
    const hour = r() < 0.55 ? pick(r, bestHours) : Math.floor(between(r, 7, 23));
    const postedDate = subDays(now, Math.floor(ageDays));
    const posted = new Date(postedDate.getFullYear(), postedDate.getMonth(), postedDate.getDate(), hour, Math.floor(r() * 60));
    if (posted.getTime() > now.getTime() - HOUR) continue;
    const roll = r();
    const productType = roll < 0.4 ? 'REELS' : 'FEED';
    const mediaType = productType === 'REELS' ? 'VIDEO' : roll < 0.7 ? 'CAROUSEL_ALBUM' : 'IMAGE';
    const mediaId = `${igId}_${String(i).padStart(3, '0')}`;
    const caption = pick(r, CAPTIONS) + (r() < 0.5 ? ` #${username}` : '');
    upsertMedia({ mediaId, igId, mediaType, mediaProductType: productType, caption, permalink: `https://www.instagram.com/p/${mediaId}/`, thumbnailPath: null, postedAt: posted.getTime(), postedHour: posted.getHours(), postedWeekday: posted.getDay(), ...analyzeCaption(caption), firstSeenAt: posted.getTime() + HOUR });

    const slotBonus = (bestHours.includes(hour) ? 1.35 : 1) * (bestDays.includes(posted.getDay()) ? 1.2 : 1);
    const typeBonus = productType === 'REELS' ? 1.6 : mediaType === 'CAROUSEL_ALBUM' ? 1.15 : 1;
    const viral = r() < 0.04 ? between(r, 3, 8) : 1;
    const finalReach = Math.max(80, Math.round(followers * reachRatio * slotBonus * typeBonus * viral * (1 + gauss(r) * 0.35)));
    const er = Math.max(0.2, erBase * slotBonus * (1 + gauss(r) * 0.4)) / 100;
    const inter = followers * er * Math.min(2.5, 0.6 + 0.4 * (finalReach / (followers * reachRatio)));
    const final = {
      reach: finalReach,
      views: Math.round(finalReach * (productType === 'REELS' ? between(r, 1.5, 3.5) : between(r, 1.05, 1.4))),
      likes: Math.round(inter * 0.72),
      comments: Math.round(inter * 0.06),
      saved: Math.round(inter * between(r, 0.08, 0.2)),
      shares: Math.round(inter * between(r, 0.03, 0.1)),
    };
    final.total_interactions = final.likes + final.comments + final.saved + final.shares;
    const ageHours = (now.getTime() - posted.getTime()) / HOUR;
    const halfLife = productType === 'REELS' ? between(r, 20, 60) : between(r, 6, 18);
    let last = null;
    for (const age of CAPTURE_AGES) {
      if (age > ageHours) break;
      const share = 1 - Math.exp(-age / halfLife);
      const capturedAt = posted.getTime() + age * HOUR;
      const values = Object.fromEntries(Object.entries(final).map(([k, v]) => [k, Math.round(v * share)]));
      for (const [metric, value] of Object.entries(values)) insertSnapshotMetric(mediaId, capturedAt, age, metric, value);
      last = { values, capturedAt };
    }
    if (!last) {
      const share = 1 - Math.exp(-ageHours / halfLife);
      last = { values: Object.fromEntries(Object.entries(final).map(([k, v]) => [k, Math.round(v * share)])), capturedAt: now.getTime() };
      for (const [metric, value] of Object.entries(last.values)) insertSnapshotMetric(mediaId, last.capturedAt, Math.floor(ageHours), metric, value);
    }
    materializeLatest(mediaId, last.values, followers, last.capturedAt);

    // comments for recent posts
    if (ageDays < 45) {
      const n = Math.min(12, Math.round(final.comments * 0.3));
      for (let c = 0; c < n; c += 1) {
        const cid = `${mediaId}_c${c}`;
        const createdAt = posted.getTime() + between(r, 0.2, 30) * HOUR;
        upsertComment({ commentId: cid, mediaId, username: pick(r, COMMENTERS), text: pick(r, COMMENT_TEXTS), likeCount: Math.floor(r() * 8), createdAt, isFromOwner: false });
        if (r() < ownerReplyRate) {
          const latency = between(r, 10, 600);
          upsertComment({ commentId: `${cid}_r`, mediaId, username, text: 'Thank you! Feel free to send us a DM 🙏', likeCount: 0, createdAt: createdAt + latency * 60_000, isFromOwner: true, parentId: cid, replyLatencyMinutes: Math.round(latency) });
        }
      }
    }
  }

  // stories (last 14 days)
  for (let d = 0; d < 14; d += 1) {
    const count = Math.floor(between(r, 0, 4));
    for (let s = 0; s < count; s += 1) {
      const postedAt = subDays(now, d).getTime() - between(r, 1, 20) * HOUR;
      const views = Math.round(followers * between(r, 0.05, 0.2));
      const exit = Math.round(views * between(r, 0.05, 0.3));
      upsertStory({ storyId: `${igId}_s${d}_${s}`, igId, mediaType: r() < 0.5 ? 'IMAGE' : 'VIDEO', permalink: null, postedAt, reach: Math.round(views * 0.92), views, replies: Math.floor(r() * 15), navForward: Math.round(views * between(r, 0.3, 0.6)), navBack: Math.round(views * between(r, 0.02, 0.1)), navExit: exit, navNextStory: Math.round(views * between(r, 0.05, 0.2)), capturedAt: postedAt + 22 * HOUR });
    }
  }

  // demographics
  const capturedAt = Date.now() - Math.floor(between(r, 0, 6)) * DAY;
  const cityWeights = CITIES.map(() => r()).sort((a, b) => b - a);
  const citySum = cityWeights.reduce((a, b) => a + b, 0);
  CITIES.forEach((c, i) => upsertDemographic(igId, capturedAt, 'city', c, Math.round((cityWeights[i] / citySum) * followers * 0.9)));
  const countryWeights = [0.8, 0.06, 0.04, 0.03, 0.03, 0.02, 0.02];
  COUNTRIES.forEach((c, i) => upsertDemographic(igId, capturedAt, 'country', c, Math.round(countryWeights[i] * followers)));
  const femaleShare = between(r, 0.3, 0.75);
  const ageWeights = [0.03, 0.22, 0.34, 0.22, 0.11, 0.05, 0.03];
  AGE_BUCKETS.forEach((a, i) => {
    upsertDemographic(igId, capturedAt, 'gender_age', `F.${a}`, Math.round(followers * ageWeights[i] * femaleShare));
    upsertDemographic(igId, capturedAt, 'gender_age', `M.${a}`, Math.round(followers * ageWeights[i] * (1 - femaleShare) * 0.95));
    upsertDemographic(igId, capturedAt, 'gender_age', `U.${a}`, Math.round(followers * ageWeights[i] * 0.05));
  });
}

function seedAds(r, profileId, today) {
  const now = new Date();
  for (let i = 0; i < 16; i += 1) {
    const igIndex = i * 2 + (i % 3);
    const brand = BRANDS[igIndex] ?? BRANDS[i];
    const igId = `1784${String(igIndex).padStart(4, '0')}`;
    const actId = `act_${5000000 + i * 137}`;
    const currency = i % 5 === 0 ? 'USD' : i % 7 === 0 ? 'EUR' : 'TRY';
    upsertAdAccount({ actId, profileId, name: `${brand[1]} Reklam`, currency, status: i === 9 ? 'DISABLED' : 'ACTIVE', linkedIgId: igId });
    const dailyBudget = currency === 'TRY' ? between(r, 400, 6000) : between(r, 15, 200);
    if (i % 4 !== 3) q.run('UPDATE ad_accounts SET monthly_budget = ? WHERE act_id = ?', Math.round(dailyBudget * 30 * between(r, 0.8, 1.3) / 100) * 100, actId);
    const cpmBase = currency === 'TRY' ? between(r, 25, 90) : between(r, 1.5, 6);
    const campaigns = CAMPAIGN_NAMES.slice(0, 3).map((n, c) => ({ id: `${actId}_c${c}`, name: n, share: [0.5, 0.3, 0.2][c] }));
    for (let d = DAYS; d >= 0; d -= 1) {
      const date = fmtDate(subDays(now, d));
      const weekday = subDays(now, d).getDay();
      const active = d > 100 ? r() < 0.4 : d < 25 && i % 4 === 1 ? r() < 0.5 : true;
      if (!active) continue;
      const spend = dailyBudget * (weekday === 0 ? 0.6 : 1) * (1 + gauss(r) * 0.2);
      const impressions = Math.round((spend / cpmBase) * 1000);
      const reach = Math.round(impressions / between(r, 1.3, 2.4));
      const ctr = between(r, 0.6, 2.4) / 100;
      const clicks = Math.round(impressions * ctr);
      const resultType = i % 3 === 0 ? 'purchase' : i % 3 === 1 ? 'lead' : 'link_click';
      const results = Math.round(clicks * (resultType === 'link_click' ? 0.9 : between(r, 0.02, 0.12)));
      const rowBase = { actId, date, spend, impressions, reach, clicks, results, resultType, postEngagement: Math.round(impressions * between(r, 0.01, 0.04)), pageEngagement: Math.round(impressions * between(r, 0.012, 0.05)), linkClicks: Math.round(clicks * 0.9) };
      upsertAdInsight({ ...rowBase, level: 'account', objectId: actId, objectName: null, ...derived(rowBase) });
      campaigns.forEach((c, ci) => {
        const cr = scale(rowBase, c.share * (1 + gauss(r) * 0.1));
        upsertAdInsight({ ...cr, level: 'campaign', objectId: c.id, objectName: c.name, parentId: actId, ...derived(cr) });
        [0, 1].forEach((ai) => {
          const ar = scale(cr, ai === 0 ? 0.6 : 0.4);
          const adsetId = `${c.id}_as${ai}`;
          upsertAdInsight({ ...ar, level: 'adset', objectId: adsetId, objectName: ADSET_NAMES[(ci * 2 + ai) % ADSET_NAMES.length], parentId: c.id, ...derived(ar) });
          [0, 1].forEach((adi) => {
            const adr = scale(ar, adi === 0 ? 0.55 : 0.45);
            upsertAdInsight({ ...adr, level: 'ad', objectId: `${adsetId}_ad${adi}`, objectName: AD_NAMES[(ci * 4 + ai * 2 + adi) % AD_NAMES.length], parentId: adsetId, ...derived(adr) });
          });
        });
      });
      const ageW = [0.05, 0.28, 0.34, 0.18, 0.09, 0.04, 0.02];
      AGE_BUCKETS.forEach((b, bi) => upsertAdBreakdown({ ...scale(rowBase, ageW[bi]), breakdown: 'age', bucket: b }));
      [['female', 0.55], ['male', 0.42], ['unknown', 0.03]].forEach(([b, w]) => upsertAdBreakdown({ ...scale(rowBase, w), breakdown: 'gender', bucket: b }));
      [['instagram', 0.7], ['facebook', 0.25], ['audience_network', 0.05]].forEach(([b, w]) => upsertAdBreakdown({ ...scale(rowBase, w), breakdown: 'publisher_platform', bucket: b }));
    }
    // Boosted posts: link each ad to a recent post of the linked Instagram account.
    const recent = q.all('SELECT media_id FROM media WHERE ig_id = ? ORDER BY posted_at DESC LIMIT 40', igId);
    campaigns.forEach((c, ci) => [0, 1].forEach((ai) => [0, 1].forEach((adi) => {
      const m = recent[(ci * 4 + ai * 2 + adi) * 3 + (i % 3)];
      if (m) upsertAdMediaLink({ actId, adId: `${c.id}_as${ai}_ad${adi}`, mediaId: m.media_id, adName: `${c.name} · ${AD_NAMES[(ci * 4 + ai * 2 + adi) % AD_NAMES.length]}` });
    })));
  }
}

function scale(row, f) {
  return { ...row, spend: row.spend * f, impressions: Math.round(row.impressions * f), reach: Math.round(row.reach * f), clicks: Math.round(row.clicks * f), results: Math.round(row.results * f), postEngagement: Math.round((row.postEngagement ?? 0) * f), pageEngagement: Math.round((row.pageEngagement ?? 0) * f), linkClicks: Math.round((row.linkClicks ?? 0) * f) };
}

function derived(row) {
  return {
    frequency: row.reach ? row.impressions / row.reach : null,
    ctr: row.impressions ? (row.clicks / row.impressions) * 100 : null,
    cpc: row.clicks ? row.spend / row.clicks : null,
    cpm: row.impressions ? (row.spend / row.impressions) * 1000 : null,
    costPerResult: row.results ? row.spend / row.results : null,
  };
}

function seedCompetitors(r, today) {
  const now = new Date();
  for (let i = 0; i < BRANDS.length; i += 2) {
    const igId = `1784${String(i).padStart(4, '0')}`;
    const count = 1 + (i % 3);
    for (let c = 0; c < count; c += 1) {
      const username = `${COMPETITOR_NAMES[(i + c) % COMPETITOR_NAMES.length]}${(i * 3 + c) % 9}`;
      const comp = addCompetitor({ username, igId, label: null });
      if (!comp) continue;
      let followers = Math.round(between(r, 3000, 250_000));
      const growth = between(r, -0.0003, 0.003);
      for (let d = 90; d >= 0; d -= 1) {
        followers = Math.round(followers * (1 + growth) + gauss(r) * 40);
        upsertCompetitorSnapshot({ competitorId: comp.id, date: fmtDate(subDays(now, d)), followers, mediaCount: 400 + Math.round((90 - d) * 0.6), avgLikes: Math.round(followers * between(r, 0.005, 0.04)), avgComments: Math.round(followers * between(r, 0.0002, 0.002)), postsLast7d: Math.floor(between(r, 1, 8)) });
      }
    }
  }
}

/** Rolls the demo dataset forward: a new snapshot + insights day for each account (used by demo sync). */
export function extendDemoDay(igIds) {
  const r = rng(Date.now() % 100_000);
  const now = new Date();
  const date = fmtDate(now);
  const tx = getDb().transaction(() => {
    for (const igId of igIds) {
      const last = q.get('SELECT followers, follows, media_count FROM account_snapshots WHERE ig_id = ? ORDER BY date DESC LIMIT 1', igId);
      if (!last) continue;
      const followers = Math.round(last.followers * (1 + between(r, -0.001, 0.004)));
      insertSnapshot({ igId, date, followers, follows: last.follows, mediaCount: last.media_count, capturedAt: now.getTime() });
      const lastReach = q.get("SELECT value FROM account_insights_daily WHERE ig_id = ? AND metric = 'reach' ORDER BY date DESC LIMIT 1", igId)?.value ?? followers * 0.3;
      const reach = Math.round(lastReach * (1 + gauss(r) * 0.2));
      upsertInsightDaily(igId, date, 'reach', reach);
      upsertInsightDaily(igId, date, 'views', Math.round(reach * 1.8));
      upsertInsightDaily(igId, date, 'profile_views', Math.round(reach * 0.04));
      upsertInsightDaily(igId, date, 'accounts_engaged', Math.round(reach * 0.07));
      markSynced(igId, now.getTime());
    }
  });
  tx();
}

export { addHours };
