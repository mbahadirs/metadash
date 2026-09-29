import { q } from '../index.js';

/** A/B caption test queries (ab_tests, ab_test_items; migration 010). v1.5 chunk D. */

function mapTest(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, hypothesis: r.hypothesis ?? null, variable: r.variable ?? null, metric: r.metric, status: r.status,
    createdAt: r.created_at, concludedAt: r.concluded_at ?? null, conclusion: r.conclusion ?? null,
  };
}

export function listAbTests() {
  return q.all('SELECT * FROM ab_tests ORDER BY (status = \'running\') DESC, created_at DESC').map(mapTest);
}

export function getAbTest(id) {
  return mapTest(q.get('SELECT * FROM ab_tests WHERE id = ?', id));
}

/** Inserts an item; duplicates (same test + target, or same test + media) are ignored. Returns true when inserted. */
export function insertAbItem(testId, { arm, targetId = null, mediaKey = null, captionVariantId = null }, { now = Date.now() } = {}) {
  const res = q.run(
    'INSERT OR IGNORE INTO ab_test_items (test_id, arm, target_id, media_key, caption_variant_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    testId, arm, targetId, mediaKey, captionVariantId, now,
  );
  return res.changes > 0;
}

/** Creates a test with its items in one transaction → id. items: [{ arm, targetId?, mediaKey?, captionVariantId? }] */
export function createAbTest({ name, hypothesis = null, variable = null, metric = 'reach_lift', items = [] }, { now = Date.now() } = {}) {
  let id;
  q.tx(() => {
    id = Number(q.run('INSERT INTO ab_tests (name, hypothesis, variable, metric, status, created_at) VALUES (?, ?, ?, ?, \'running\', ?)', name, hypothesis, variable, metric, now).lastInsertRowid);
    for (const it of items) insertAbItem(id, it, { now });
  })();
  return id;
}

export function removeAbItem(testId, itemId) {
  return q.run('DELETE FROM ab_test_items WHERE test_id = ? AND id = ?', testId, itemId).changes > 0;
}

export function concludeAbTest(id, conclusion, { now = Date.now() } = {}) {
  q.run('UPDATE ab_tests SET status = \'concluded\', concluded_at = ?, conclusion = ? WHERE id = ?', now, conclusion ?? null, id);
}

export function reopenAbTest(id) {
  q.run('UPDATE ab_tests SET status = \'running\', concluded_at = NULL WHERE id = ?', id);
}

export function deleteAbTest(id) {
  return q.run('DELETE FROM ab_tests WHERE id = ?', id).changes > 0;
}

/**
 * Items with the media they resolve to: item.media_key, else the planner target's media_key (set once the published
 * post is synced), plus the media's metrics and the post's caption source.
 */
export function abItemsWithMedia(testId) {
  return q.all(
    `SELECT i.id, i.arm, i.target_id AS targetId, i.caption_variant_id AS captionVariantId,
       COALESCE(i.media_key, t.media_key) AS mediaKey,
       t.state AS targetState, t.platform AS targetPlatform, t.account_id AS targetAccountId, t.post_id AS postId,
       COALESCE(t.caption_override, pp.caption) AS plannedCaption, pp.scheduled_at AS scheduledAt,
       m.ig_id AS igId, m.posted_at AS postedAt, m.caption, m.media_type AS mediaType, m.media_product_type AS mediaProductType,
       m.permalink, m.thumbnail_path AS thumbnailPath,
       a.platform, a.username,
       l.reach, l.views, l.saved, l.engagement_rate AS engagementRate, l.likes, l.comments,
       cv.text AS variantText, cv.label AS variantLabel
     FROM ab_test_items i
     LEFT JOIN planner_targets t ON t.id = i.target_id
     LEFT JOIN planner_posts pp ON pp.id = t.post_id
     LEFT JOIN media m ON m.media_id = COALESCE(i.media_key, t.media_key) AND m.is_deleted = 0
     LEFT JOIN media_latest l ON l.media_id = m.media_id
     LEFT JOIN accounts a ON a.ig_id = COALESCE(m.ig_id, t.account_id)
     LEFT JOIN caption_variants cv ON cv.id = i.caption_variant_id
     WHERE i.test_id = ?
     ORDER BY i.arm, i.id`,
    testId,
  );
}

export function abItemCounts() {
  return q.all('SELECT test_id AS testId, arm, COUNT(*) AS n FROM ab_test_items GROUP BY test_id, arm');
}

/** Planner targets for the post a caption variant belongs to (used when an arm is built from caption variants). */
export function targetsForCaptionVariant(variantId) {
  return q.all(
    'SELECT t.id AS targetId, t.media_key AS mediaKey FROM caption_variants cv JOIN planner_targets t ON t.post_id = cv.post_id WHERE cv.id = ?',
    variantId,
  );
}

export function captionVariantExists(variantId) {
  return !!q.get('SELECT 1 AS x FROM caption_variants WHERE id = ?', variantId);
}

export function targetExists(targetId) {
  return q.get('SELECT id, media_key AS mediaKey FROM planner_targets WHERE id = ?', targetId) ?? null;
}

export function mediaExists(mediaKey) {
  return !!q.get('SELECT 1 AS x FROM media WHERE media_id = ?', mediaKey);
}

/** Candidates to tag: recent synced posts and planner targets (not canceled), newest first. */
export function abCandidates({ accountIds, since, limit = 100 } = {}) {
  const lim = Math.min(Math.max(1, Math.trunc(limit)), 300);
  const accFilter = (col) => (accountIds?.length ? `AND ${col} IN (${accountIds.map(() => '?').join(',')})` : '');
  const media = q.all(
    `SELECT m.media_id AS mediaKey, m.ig_id AS accountId, a.username, a.platform, m.caption, m.posted_at AS postedAt,
       m.media_type AS mediaType, m.media_product_type AS mediaProductType, m.thumbnail_path AS thumbnailPath, l.reach, l.views
     FROM media m JOIN accounts a ON a.ig_id = m.ig_id LEFT JOIN media_latest l ON l.media_id = m.media_id
     WHERE m.is_deleted = 0 AND a.is_tracked = 1 AND m.posted_at >= ? AND COALESCE(m.media_product_type, '') <> 'STORY' ${accFilter('m.ig_id')}
     ORDER BY m.posted_at DESC LIMIT ${lim}`,
    since, ...(accountIds ?? []),
  );
  const targets = q.all(
    `SELECT t.id AS targetId, t.post_id AS postId, t.account_id AS accountId, a.username, t.platform, t.state, t.media_key AS mediaKey,
       COALESCE(t.caption_override, p.caption) AS caption, p.scheduled_at AS scheduledAt, p.status, p.ref
     FROM planner_targets t JOIN planner_posts p ON p.id = t.post_id LEFT JOIN accounts a ON a.ig_id = t.account_id
     WHERE p.deleted_at IS NULL AND t.state NOT IN ('canceled') AND COALESCE(p.scheduled_at, p.updated_at) >= ? ${accFilter('t.account_id')}
     ORDER BY COALESCE(p.scheduled_at, p.updated_at) DESC LIMIT ${lim}`,
    since, ...(accountIds ?? []),
  );
  return { media, targets };
}
