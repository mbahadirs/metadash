import { q } from '../index.js';

export function upsertMedia(m) {
  q.run(
    `INSERT INTO media (media_id, ig_id, media_type, media_product_type, caption, permalink, thumbnail_path, posted_at,
       posted_hour, posted_weekday, caption_length, hashtag_count, mention_count, emoji_count, is_deleted, first_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(media_id) DO UPDATE SET caption = excluded.caption, permalink = excluded.permalink,
       thumbnail_path = COALESCE(excluded.thumbnail_path, media.thumbnail_path), is_deleted = 0,
       caption_length = excluded.caption_length, hashtag_count = excluded.hashtag_count,
       mention_count = excluded.mention_count, emoji_count = excluded.emoji_count`,
    m.mediaId, m.igId, m.mediaType, m.mediaProductType, m.caption ?? null, m.permalink ?? null, m.thumbnailPath ?? null,
    m.postedAt, m.postedHour, m.postedWeekday, m.captionLength ?? 0, m.hashtagCount ?? 0, m.mentionCount ?? 0,
    m.emojiCount ?? 0, m.firstSeenAt ?? Date.now(),
  );
}

export function insertSnapshotMetric(mediaId, capturedAt, ageHours, metric, value) {
  q.run(
    `INSERT INTO media_insight_snapshots (media_id, captured_at, age_hours, metric, value) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(media_id, captured_at, metric) DO UPDATE SET value = excluded.value, age_hours = excluded.age_hours`,
    mediaId, capturedAt, ageHours, metric, value,
  );
}

export function upsertLatest(mediaId, metrics, engagementRate, updatedAt = Date.now()) {
  q.run(
    `INSERT INTO media_latest (media_id, reach, views, likes, comments, saved, shares, total_interactions, engagement_rate, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(media_id) DO UPDATE SET reach = excluded.reach, views = excluded.views, likes = excluded.likes,
       comments = excluded.comments, saved = excluded.saved, shares = excluded.shares,
       total_interactions = excluded.total_interactions, engagement_rate = excluded.engagement_rate, updated_at = excluded.updated_at`,
    mediaId, metrics.reach ?? null, metrics.views ?? null, metrics.likes ?? null, metrics.comments ?? null,
    metrics.saved ?? null, metrics.shares ?? null, metrics.total_interactions ?? null, engagementRate ?? null, updatedAt,
  );
}

export function latestMetricsOf(mediaId) {
  return q.get('SELECT * FROM media_latest WHERE media_id = ?', mediaId) || null;
}

const PAID_SUB = `(SELECT l.media_id, SUM(i.spend) AS spend, SUM(i.reach) AS paid_reach, SUM(i.impressions) AS paid_impressions, SUM(i.clicks) AS paid_clicks, SUM(i.results) AS paid_results, SUM(i.post_engagement) AS paid_post_engagement, SUM(i.page_engagement) AS paid_page_engagement, MAX(i.result_type) AS paid_result_type, COUNT(DISTINCT l.ad_id) AS ad_count, MAX(a2.currency) AS currency
    FROM ad_media_links l JOIN ad_insights_daily i ON i.level = 'ad' AND i.object_id = l.ad_id AND i.act_id = l.act_id JOIN ad_accounts a2 ON a2.act_id = l.act_id GROUP BY l.media_id)`;

const MEDIA_SELECT = `
  SELECT m.*, l.reach, l.views, l.likes, l.comments, l.saved, l.shares, l.total_interactions, l.engagement_rate,
    a.username, a.client_name, a.color AS account_color, a.profile_pic_url,
    p.spend, p.paid_reach, p.paid_impressions, p.paid_clicks, p.paid_results, p.paid_post_engagement, p.paid_page_engagement, p.paid_result_type, p.ad_count, p.currency AS paid_currency
  FROM media m
  LEFT JOIN media_latest l ON l.media_id = m.media_id
  LEFT JOIN ${PAID_SUB} p ON p.media_id = m.media_id
  JOIN accounts a ON a.ig_id = m.ig_id`;

export function mapMedia(row) {
  return {
    mediaId: row.media_id,
    igId: row.ig_id,
    username: row.username,
    clientName: row.client_name,
    accountColor: row.account_color,
    profilePicUrl: row.profile_pic_url,
    mediaType: row.media_type,
    mediaProductType: row.media_product_type,
    caption: row.caption,
    permalink: row.permalink,
    thumbnailPath: row.thumbnail_path,
    postedAt: row.posted_at,
    postedHour: row.posted_hour,
    postedWeekday: row.posted_weekday,
    captionLength: row.caption_length,
    hashtagCount: row.hashtag_count,
    mentionCount: row.mention_count,
    emojiCount: row.emoji_count,
    isDeleted: !!row.is_deleted,
    reach: row.reach,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    saved: row.saved,
    shares: row.shares,
    totalInteractions: row.total_interactions,
    engagementRate: row.engagement_rate,
    saveRate: row.reach ? ((row.saved ?? 0) / row.reach) * 100 : null,
    spend: row.spend ?? null,
    paidReach: row.paid_reach ?? null,
    paidImpressions: row.paid_impressions ?? null,
    paidClicks: row.paid_clicks ?? null,
    paidResults: row.paid_results ?? null,
    paidPostEngagement: row.paid_post_engagement ?? null,
    paidPageEngagement: row.paid_page_engagement ?? null,
    paidResultType: row.paid_result_type ?? null,
    adCount: row.ad_count ?? 0,
    paidCurrency: row.paid_currency ?? null,
    // organic + paid totals: views ≈ organic impressions, paid_impressions = ad impressions
    totalReach: (row.reach ?? 0) + (row.paid_reach ?? 0),
    totalImpressions: (row.views ?? 0) + (row.paid_impressions ?? 0),
    paidReachShare: (row.reach ?? 0) + (row.paid_reach ?? 0) > 0 ? ((row.paid_reach ?? 0) / ((row.reach ?? 0) + (row.paid_reach ?? 0))) * 100 : null,
    paidImpressionShare: (row.views ?? 0) + (row.paid_impressions ?? 0) > 0 ? ((row.paid_impressions ?? 0) / ((row.views ?? 0) + (row.paid_impressions ?? 0))) * 100 : null,
    costPerResult: row.paid_results > 0 ? row.spend / row.paid_results : null,
    paidFrequency: row.paid_reach > 0 ? row.paid_impressions / row.paid_reach : null,
    paidCpc: row.paid_clicks > 0 ? row.spend / row.paid_clicks : null,
    paidCtr: row.paid_impressions > 0 ? (row.paid_clicks / row.paid_impressions) * 100 : null,
    paidCpm: row.paid_impressions > 0 ? (row.spend / row.paid_impressions) * 1000 : null,
    costPerPostEngagement: row.paid_post_engagement > 0 ? row.spend / row.paid_post_engagement : null,
    costPerPageEngagement: row.paid_page_engagement > 0 ? row.spend / row.paid_page_engagement : null,
  };
}

/** Classifies a media row into a UI-facing type key. */
export function mediaTypeKey(m) {
  const product = m.mediaProductType ?? m.media_product_type;
  const type = m.mediaType ?? m.media_type;
  if (product === 'REELS') return 'reels';
  if (product === 'STORY') return 'story';
  if (type === 'CAROUSEL_ALBUM') return 'carousel';
  if (type === 'VIDEO') return 'video';
  return 'image';
}

const TYPE_SQL = {
  reels: "m.media_product_type = 'REELS'",
  carousel: "m.media_product_type <> 'REELS' AND m.media_type = 'CAROUSEL_ALBUM'",
  video: "m.media_product_type <> 'REELS' AND m.media_type = 'VIDEO'",
  image: "m.media_product_type <> 'REELS' AND m.media_type = 'IMAGE'",
  story: "m.media_product_type = 'STORY'",
};

/** Lists media with optional filters (ms timestamps for from/to). */
export function listMedia({ igIds, from, to, types, typeKeys, hashtag, minReach, search, limit, sort, onlyPaid } = {}) {
  const where = ['m.is_deleted = 0', 'a.is_tracked = 1'];
  const params = [];
  if (igIds?.length) { where.push(`m.ig_id IN (${igIds.map(() => '?').join(',')})`); params.push(...igIds); }
  if (from) { where.push('m.posted_at >= ?'); params.push(from); }
  if (to) { where.push('m.posted_at <= ?'); params.push(to); }
  if (types?.length) { where.push(`m.media_product_type IN (${types.map(() => '?').join(',')})`); params.push(...types); }
  const keys = (typeKeys ?? []).filter((k) => TYPE_SQL[k]);
  if (keys.length) where.push(`(${keys.map((k) => `(${TYPE_SQL[k]})`).join(' OR ')})`);
  if (onlyPaid) where.push('p.spend > 0');
  if (hashtag) { where.push('m.caption LIKE ?'); params.push(`%#${hashtag.replace(/^#/, '')}%`); }
  if (minReach) { where.push('l.reach >= ?'); params.push(minReach); }
  if (search) { where.push('m.caption LIKE ?'); params.push(`%${search}%`); }
  const orderMap = { reach: 'l.reach', er: 'l.engagement_rate', saved: 'l.saved', date: 'm.posted_at', likes: 'l.likes', views: 'l.views', spend: 'p.spend', totalReach: '(COALESCE(l.reach,0)+COALESCE(p.paid_reach,0))' };
  const order = orderMap[sort] ?? 'm.posted_at';
  const sql = `${MEDIA_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} DESC NULLS LAST ${limit ? `LIMIT ${Number(limit)}` : ''}`;
  return q.all(sql, ...params).map(mapMedia);
}

export function getMediaByIds(ids) {
  if (!ids?.length) return [];
  return q.all(`${MEDIA_SELECT} WHERE m.media_id IN (${ids.map(() => '?').join(',')}) ORDER BY m.posted_at DESC`, ...ids).map(mapMedia);
}

export function getMedia(mediaId) {
  const row = q.get(`${MEDIA_SELECT} WHERE m.media_id = ?`, mediaId);
  return row ? mapMedia(row) : null;
}

export function mediaForAccount(igId, sinceMs = 0) {
  return q.all('SELECT media_id, posted_at, media_product_type, media_type FROM media WHERE ig_id = ? AND posted_at >= ? AND is_deleted = 0', igId, sinceMs);
}

export function lastSnapshotAt(mediaId) {
  return q.get('SELECT MAX(captured_at) AS c FROM media_insight_snapshots WHERE media_id = ?', mediaId)?.c ?? null;
}

export function snapshotsForMedia(mediaId) {
  return q.all('SELECT captured_at AS capturedAt, age_hours AS ageHours, metric, value FROM media_insight_snapshots WHERE media_id = ? ORDER BY captured_at', mediaId);
}

export function snapshotsForAccount(igId, fromMs, toMs) {
  return q.all(
    `SELECT s.media_id AS mediaId, s.age_hours AS ageHours, s.metric, s.value
     FROM media_insight_snapshots s JOIN media m ON m.media_id = s.media_id
     WHERE m.ig_id = ? AND m.posted_at BETWEEN ? AND ? ORDER BY s.media_id, s.captured_at`,
    igId, fromMs, toMs,
  );
}

export function postCounts(fromMs, toMs, igIds) {
  const filter = igIds?.length ? `AND ig_id IN (${igIds.map(() => '?').join(',')})` : '';
  return q.all(
    `SELECT ig_id AS igId, COUNT(*) AS count FROM media WHERE is_deleted = 0 AND posted_at BETWEEN ? AND ? ${filter} GROUP BY ig_id`,
    fromMs, toMs, ...(igIds ?? []),
  );
}

export function lastPostAt(igId) {
  return q.get('SELECT MAX(posted_at) AS p FROM media WHERE ig_id = ? AND is_deleted = 0', igId)?.p ?? null;
}

export function aggregateMedia(igId, fromMs, toMs) {
  return q.get(
    `SELECT COUNT(*) AS posts, SUM(l.reach) AS reach, SUM(l.views) AS views, SUM(l.likes) AS likes, SUM(l.comments) AS comments,
       SUM(l.saved) AS saved, SUM(l.shares) AS shares, AVG(l.engagement_rate) AS avgEr,
       AVG(CASE WHEN l.reach > 0 THEN l.saved * 1.0 / l.reach END) AS saveRate
     FROM media m LEFT JOIN media_latest l ON l.media_id = m.media_id
     WHERE m.ig_id = ? AND m.is_deleted = 0 AND m.posted_at BETWEEN ? AND ?`,
    igId, fromMs, toMs,
  );
}

export function aggregateByType(igId, fromMs, toMs) {
  return q.all(
    `SELECT m.media_product_type AS productType, m.media_type AS mediaType, COUNT(*) AS posts,
       AVG(l.reach) AS avgReach, AVG(l.likes) AS avgLikes, AVG(l.comments) AS avgComments, AVG(l.saved) AS avgSaved,
       AVG(l.engagement_rate) AS avgEr
     FROM media m LEFT JOIN media_latest l ON l.media_id = m.media_id
     WHERE m.ig_id = ? AND m.is_deleted = 0 AND m.posted_at BETWEEN ? AND ?
     GROUP BY m.media_product_type, m.media_type`,
    igId, fromMs, toMs,
  );
}

export function weeklyPostCounts(igId, fromMs, toMs) {
  return q.all(
    `SELECT strftime('%Y-%W', posted_at / 1000, 'unixepoch') AS week, COUNT(*) AS count
     FROM media WHERE ig_id = ? AND is_deleted = 0 AND posted_at BETWEEN ? AND ? GROUP BY week ORDER BY week`,
    igId, fromMs, toMs,
  );
}

export function listNotes(entityType, entityId) {
  return q.all('SELECT * FROM notes WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC', entityType, entityId);
}

export function addNote(entityType, entityId, body) {
  const res = q.run('INSERT INTO notes (entity_type, entity_id, body, created_at) VALUES (?, ?, ?, ?)', entityType, entityId, body, Date.now());
  return q.get('SELECT * FROM notes WHERE id = ?', res.lastInsertRowid);
}

export function deleteNote(id) {
  q.run('DELETE FROM notes WHERE id = ?', id);
}

export function commentStats(igId, fromMs, toMs) {
  return q.get(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN c.is_from_owner = 0 AND EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.comment_id AND r.is_from_owner = 1) THEN 1 ELSE 0 END) AS answered,
       SUM(CASE WHEN c.is_from_owner = 0 THEN 1 ELSE 0 END) AS incoming,
       AVG(CASE WHEN c.is_from_owner = 1 THEN c.reply_latency_minutes END) AS avgLatency
     FROM comments c JOIN media m ON m.media_id = c.media_id
     WHERE m.ig_id = ? AND c.created_at BETWEEN ? AND ?`,
    igId, fromMs, toMs,
  );
}

export function upsertComment(c) {
  q.run(
    `INSERT INTO comments (comment_id, media_id, username, text, like_count, created_at, is_from_owner, parent_id, reply_latency_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(comment_id) DO UPDATE SET like_count = excluded.like_count, text = excluded.text`,
    c.commentId, c.mediaId, c.username, c.text, c.likeCount ?? 0, c.createdAt, c.isFromOwner ? 1 : 0, c.parentId ?? null, c.replyLatencyMinutes ?? null,
  );
}

export function commentsForMedia(mediaId) {
  return q.all('SELECT * FROM comments WHERE media_id = ? ORDER BY created_at', mediaId);
}

/** Per-type averages for an account over a window — the benchmark shown next to a single post's metrics. */
export function typeBenchmarks(igId, fromMs, toMs) {
  const rows = q.all(
    `SELECT m.media_product_type AS productType, m.media_type AS mediaType, COUNT(*) AS posts,
       AVG(l.reach) AS reach, AVG(l.views) AS views, AVG(l.likes) AS likes, AVG(l.comments) AS comments, AVG(l.saved) AS saved,
       AVG(l.shares) AS shares, AVG(l.engagement_rate) AS engagementRate,
       AVG(CASE WHEN l.reach > 0 THEN l.saved * 100.0 / l.reach END) AS saveRate
     FROM media m LEFT JOIN media_latest l ON l.media_id = m.media_id
     WHERE m.ig_id = ? AND m.is_deleted = 0 AND m.posted_at BETWEEN ? AND ?
     GROUP BY m.media_product_type, m.media_type`,
    igId, fromMs, toMs,
  );
  const out = {};
  for (const r of rows) {
    const key = mediaTypeKey({ media_product_type: r.productType, media_type: r.mediaType });
    out[key] = r;
  }
  return out;
}

/** Reach rank of one media among the account's posts in a window (1 = best). */
export function reachRank(igId, mediaId, fromMs, toMs) {
  const row = q.get(
    `SELECT (SELECT COUNT(*) FROM media m2 LEFT JOIN media_latest l2 ON l2.media_id = m2.media_id
              WHERE m2.ig_id = ? AND m2.is_deleted = 0 AND m2.posted_at BETWEEN ? AND ? AND l2.reach > COALESCE(l.reach, 0)) + 1 AS rank,
            (SELECT COUNT(*) FROM media m3 WHERE m3.ig_id = ? AND m3.is_deleted = 0 AND m3.posted_at BETWEEN ? AND ?) AS total
     FROM media m LEFT JOIN media_latest l ON l.media_id = m.media_id WHERE m.media_id = ?`,
    igId, fromMs, toMs, igId, fromMs, toMs, mediaId,
  );
  return row ?? { rank: null, total: 0 };
}
