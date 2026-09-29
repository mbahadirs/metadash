import { q } from '../index.js';

const SERIES_COLORS = ['#4F7CFF', '#3FBF8F', '#E8B44A', '#C06CE8', '#E5605F', '#48C3D6'];

export function pickColor(index) {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export const PLATFORMS = ['instagram', 'facebook', 'threads'];

/** Lists accounts. `platforms` (array) narrows to those platforms; omitted/empty = every platform. */
export function listAccounts({ tagIds, search, onlyTracked = true, platforms } = {}) {
  const where = [];
  const params = [];
  if (onlyTracked) where.push('a.is_tracked = 1');
  if (platforms?.length) {
    where.push(`a.platform IN (${platforms.map(() => '?').join(',')})`);
    params.push(...platforms);
  }
  if (search) {
    where.push('(a.username LIKE ? OR a.name LIKE ? OR a.client_name LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (tagIds && tagIds.length) {
    where.push(`a.ig_id IN (SELECT ig_id FROM account_tags WHERE tag_id IN (${tagIds.map(() => '?').join(',')}))`);
    params.push(...tagIds);
  }
  const sql = `
    SELECT a.*,
      (SELECT followers FROM account_snapshots s WHERE s.ig_id = a.ig_id ORDER BY date DESC LIMIT 1) AS followers,
      (SELECT media_count FROM account_snapshots s WHERE s.ig_id = a.ig_id ORDER BY date DESC LIMIT 1) AS media_count,
      (SELECT group_concat(tag_id) FROM account_tags t WHERE t.ig_id = a.ig_id) AS tag_ids
    FROM accounts a
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.username`;
  return q.all(sql, ...params).map(mapAccount);
}

export function getAccount(igId) {
  const row = q.get(
    `SELECT a.*,
      (SELECT followers FROM account_snapshots s WHERE s.ig_id = a.ig_id ORDER BY date DESC LIMIT 1) AS followers,
      (SELECT follows FROM account_snapshots s WHERE s.ig_id = a.ig_id ORDER BY date DESC LIMIT 1) AS follows,
      (SELECT media_count FROM account_snapshots s WHERE s.ig_id = a.ig_id ORDER BY date DESC LIMIT 1) AS media_count,
      (SELECT group_concat(tag_id) FROM account_tags t WHERE t.ig_id = a.ig_id) AS tag_ids
     FROM accounts a WHERE a.ig_id = ?`,
    igId,
  );
  return row ? mapAccount(row) : null;
}

/**
 * Row → Account. NOTE: `igId` (column ig_id) is the *account key*, not necessarily an Instagram id:
 * raw IG id for Instagram, 'fb-<pageId>' for Facebook Pages, 'th-<userId>' for Threads. `externalId` is the raw API id.
 */
function mapAccount(row) {
  return {
    igId: row.ig_id,
    platform: row.platform ?? 'instagram',
    externalId: row.external_id ?? row.ig_id,
    linkedAccountId: row.linked_account_id ?? null,
    profileId: row.profile_id,
    pageId: row.page_id,
    username: row.username,
    name: row.name,
    profilePicUrl: row.profile_pic_url,
    biography: row.biography,
    website: row.website,
    isTracked: !!row.is_tracked,
    clientName: row.client_name,
    color: row.color,
    firstSeenAt: row.first_seen_at,
    lastSyncedAt: row.last_synced_at,
    followers: row.followers ?? null,
    follows: row.follows ?? null,
    mediaCount: row.media_count ?? null,
    tagIds: row.tag_ids ? String(row.tag_ids).split(',').map(Number) : [],
  };
}

/**
 * Inserts or updates an account row keyed by `igId` (the account key). `platform` defaults to 'instagram' and is only
 * written on insert; `externalId` defaults to the key; `linkedAccountId` is kept when not given.
 */
export function upsertAccount(acc) {
  const existing = q.get('SELECT ig_id, color FROM accounts WHERE ig_id = ?', acc.igId);
  if (existing) {
    q.run(
      `UPDATE accounts SET profile_id = ?, page_id = ?, username = ?, name = ?, profile_pic_url = ?, biography = ?, website = ?,
         external_id = COALESCE(?, external_id, ig_id), linked_account_id = COALESCE(?, linked_account_id)
       WHERE ig_id = ?`,
      acc.profileId, acc.pageId ?? null, acc.username, acc.name ?? null, acc.profilePicUrl ?? null,
      acc.biography ?? null, acc.website ?? null, acc.externalId ?? null, acc.linkedAccountId ?? null, acc.igId,
    );
    return;
  }
  const count = q.get('SELECT COUNT(*) AS c FROM accounts').c;
  q.run(
    `INSERT INTO accounts (ig_id, profile_id, page_id, username, name, profile_pic_url, biography, website, is_tracked, client_name, color, first_seen_at,
       platform, external_id, linked_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    acc.igId, acc.profileId, acc.pageId ?? null, acc.username, acc.name ?? null, acc.profilePicUrl ?? null,
    acc.biography ?? null, acc.website ?? null, acc.isTracked === false ? 0 : 1, acc.clientName ?? null,
    acc.color ?? pickColor(count), acc.firstSeenAt ?? Date.now(),
    acc.platform ?? 'instagram', acc.externalId ?? acc.igId, acc.linkedAccountId ?? null,
  );
}

export function updateAccount(igId, patch) {
  const sets = [];
  const params = [];
  if (patch.clientName !== undefined) { sets.push('client_name = ?'); params.push(patch.clientName); }
  if (patch.color !== undefined) { sets.push('color = ?'); params.push(patch.color); }
  if (patch.isTracked !== undefined) { sets.push('is_tracked = ?'); params.push(patch.isTracked ? 1 : 0); }
  if (!sets.length) return;
  params.push(igId);
  q.run(`UPDATE accounts SET ${sets.join(', ')} WHERE ig_id = ?`, ...params);
}

/** Sets the tracked set for one platform only: accounts of `platform` not in `igIds` are untracked; other platforms untouched. */
export function setTrackedAccounts(igIds, { platform = 'instagram' } = {}) {
  const tx = q.tx((ids) => {
    q.run('UPDATE accounts SET is_tracked = 0 WHERE platform = ?', platform);
    for (const id of ids) q.run('UPDATE accounts SET is_tracked = 1 WHERE ig_id = ? AND platform = ?', id, platform);
  });
  tx(igIds ?? []);
}

export function markSynced(igId, at = Date.now()) {
  q.run('UPDATE accounts SET last_synced_at = ? WHERE ig_id = ?', at, igId);
}

export function insertSnapshot({ igId, date, followers, follows, mediaCount, capturedAt = Date.now() }) {
  q.run(
    `INSERT INTO account_snapshots (ig_id, date, followers, follows, media_count, captured_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ig_id, date) DO UPDATE SET followers = excluded.followers, follows = excluded.follows,
       media_count = excluded.media_count, captured_at = excluded.captured_at`,
    igId, date, followers ?? null, follows ?? null, mediaCount ?? null, capturedAt,
  );
}

export function snapshotSeries(igId, from, to) {
  return q.all(
    'SELECT date, followers, follows, media_count AS mediaCount FROM account_snapshots WHERE ig_id = ? AND date BETWEEN ? AND ? ORDER BY date',
    igId, from, to,
  );
}

export function followersAt(igId, date, direction = 'before') {
  const op = direction === 'before' ? '<=' : '>=';
  const order = direction === 'before' ? 'DESC' : 'ASC';
  const row = q.get(
    `SELECT followers, date FROM account_snapshots WHERE ig_id = ? AND date ${op} ? ORDER BY date ${order} LIMIT 1`,
    igId, date,
  );
  return row ? row.followers : null;
}

export function latestFollowers(igId) {
  const row = q.get('SELECT followers FROM account_snapshots WHERE ig_id = ? ORDER BY date DESC LIMIT 1', igId);
  return row ? row.followers : null;
}

export function upsertInsightDaily(igId, date, metric, value) {
  q.run(
    `INSERT INTO account_insights_daily (ig_id, date, metric, value) VALUES (?, ?, ?, ?)
     ON CONFLICT(ig_id, date, metric) DO UPDATE SET value = excluded.value`,
    igId, date, metric, value,
  );
}

export function insightSeries(igId, from, to, metrics) {
  const rows = q.all(
    `SELECT date, metric, value FROM account_insights_daily WHERE ig_id = ? AND date BETWEEN ? AND ?
       AND metric IN (${metrics.map(() => '?').join(',')}) ORDER BY date`,
    igId, from, to, ...metrics,
  );
  const byDate = new Map();
  for (const r of rows) {
    const cur = byDate.get(r.date) ?? { date: r.date };
    byDate.set(r.date, { ...cur, [r.metric]: r.value });
  }
  return [...byDate.values()];
}

export function insightSum(igId, from, to, metric) {
  const row = q.get(
    'SELECT SUM(value) AS v FROM account_insights_daily WHERE ig_id = ? AND date BETWEEN ? AND ? AND metric = ?',
    igId, from, to, metric,
  );
  return row?.v ?? 0;
}

export function insightSumAll(from, to, metric, igIds) {
  const filter = igIds?.length ? `AND ig_id IN (${igIds.map(() => '?').join(',')})` : '';
  const row = q.get(
    `SELECT SUM(value) AS v FROM account_insights_daily WHERE date BETWEEN ? AND ? AND metric = ? ${filter}`,
    from, to, metric, ...(igIds ?? []),
  );
  return row?.v ?? 0;
}

export function upsertDemographic(igId, capturedAt, dimension, bucket, value) {
  q.run(
    `INSERT INTO account_demographics (ig_id, captured_at, dimension, bucket, value) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ig_id, captured_at, dimension, bucket) DO UPDATE SET value = excluded.value`,
    igId, capturedAt, dimension, bucket, value,
  );
}

export function latestDemographics(igId) {
  const latest = q.get('SELECT MAX(captured_at) AS c FROM account_demographics WHERE ig_id = ?', igId);
  if (!latest?.c) return { capturedAt: null, city: [], genderAge: [], country: [] };
  const rows = q.all(
    'SELECT dimension, bucket, value FROM account_demographics WHERE ig_id = ? AND captured_at = ? ORDER BY value DESC',
    igId, latest.c,
  );
  return {
    capturedAt: latest.c,
    city: rows.filter((r) => r.dimension === 'city').map(({ bucket, value }) => ({ bucket, value })),
    genderAge: rows.filter((r) => r.dimension === 'gender_age').map(({ bucket, value }) => ({ bucket, value })),
    country: rows.filter((r) => r.dimension === 'country').map(({ bucket, value }) => ({ bucket, value })),
  };
}

export function lastDemographicCapture(igId) {
  return q.get('SELECT MAX(captured_at) AS c FROM account_demographics WHERE ig_id = ?', igId)?.c ?? null;
}
