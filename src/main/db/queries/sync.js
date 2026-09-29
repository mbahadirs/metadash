import { q } from '../index.js';

export function createRun(scope, accountsTotal) {
  const res = q.run(
    'INSERT INTO sync_runs (started_at, scope, status, accounts_done, accounts_total, api_calls) VALUES (?, ?, ?, 0, ?, 0)',
    Date.now(), scope, 'running', accountsTotal,
  );
  return Number(res.lastInsertRowid);
}

export function updateRun(id, patch) {
  const sets = [];
  const params = [];
  for (const [col, key] of [['finished_at', 'finishedAt'], ['status', 'status'], ['accounts_done', 'accountsDone'],
    ['accounts_total', 'accountsTotal'], ['api_calls', 'apiCalls'], ['error_summary', 'errorSummary']]) {
    if (patch[key] !== undefined) { sets.push(`${col} = ?`); params.push(patch[key]); }
  }
  if (!sets.length) return;
  params.push(id);
  q.run(`UPDATE sync_runs SET ${sets.join(', ')} WHERE id = ?`, ...params);
}

/** Records a sync error. `igId` = account key (any platform); `platform` = 'instagram' | 'facebook' | 'threads' | null. */
export function logError(runId, { igId, endpoint, code, message, platform }) {
  q.run('INSERT INTO sync_errors (run_id, ig_id, endpoint, code, message, at, platform) VALUES (?, ?, ?, ?, ?, ?, ?)',
    runId, igId ?? null, endpoint ?? null, code ?? null, String(message ?? '').slice(0, 500), Date.now(), platform ?? null);
}

export function listRuns(limit = 20) {
  return q.all(
    `SELECT r.id, r.started_at AS startedAt, r.finished_at AS finishedAt, r.scope, r.status, r.accounts_done AS accountsDone,
       r.accounts_total AS accountsTotal, r.api_calls AS apiCalls, r.error_summary AS errorSummary,
       (SELECT COUNT(*) FROM sync_errors e WHERE e.run_id = r.id) AS errorCount
     FROM sync_runs r ORDER BY r.id DESC LIMIT ?`,
    limit,
  );
}

export function lastSuccessfulRun(scope) {
  const filter = scope ? 'AND scope IN (?, "full")' : '';
  return q.get(`SELECT * FROM sync_runs WHERE status IN ('ok', 'partial') ${filter} ORDER BY id DESC LIMIT 1`, ...(scope ? [scope] : [])) || null;
}

export function recentErrors(limit = 50) {
  return q.all(
    `SELECT e.id, e.run_id AS runId, e.ig_id AS igId, COALESCE(e.platform, a.platform) AS platform, a.username, e.endpoint, e.code, e.message, e.at
     FROM sync_errors e LEFT JOIN accounts a ON a.ig_id = e.ig_id ORDER BY e.id DESC LIMIT ?`,
    limit,
  );
}

export function accountsWithRecentErrors(sinceMs) {
  return q.all(
    `SELECT DISTINCT ig_id AS igId, MAX(code) AS code, MAX(message) AS message FROM sync_errors WHERE at >= ? AND ig_id IS NOT NULL GROUP BY ig_id`,
    sinceMs,
  );
}

/**
 * Metrics Meta rejected. Instagram rows come from disabled_metrics (platform 'instagram'); other platforms from
 * metric_resolution rows with status 'unsupported' (`metric` = canonical name).
 */
export function listDisabledMetrics() {
  return q.all(
    `SELECT metric, scope, reason, disabledAt, platform FROM (
       SELECT metric, scope, reason, disabled_at AS disabledAt, 'instagram' AS platform FROM disabled_metrics
       UNION ALL
       SELECT canonical AS metric, scope, reason, updated_at AS disabledAt, platform FROM metric_resolution WHERE status = 'unsupported'
     ) ORDER BY disabledAt DESC`,
  );
}

export function disableMetric(metric, scope, reason) {
  q.run(
    `INSERT INTO disabled_metrics (metric, scope, reason, disabled_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(metric) DO UPDATE SET reason = excluded.reason, disabled_at = excluded.disabled_at`,
    metric, scope, reason, Date.now(),
  );
}

/** Re-enables a metric. Without a platform (or 'instagram') it clears disabled_metrics; otherwise the metric_resolution rows. */
export function enableMetric(metric, { platform, scope } = {}) {
  if (!platform || platform === 'instagram') {
    q.run('DELETE FROM disabled_metrics WHERE metric = ?', metric);
    return;
  }
  if (scope) q.run('DELETE FROM metric_resolution WHERE platform = ? AND scope = ? AND canonical = ?', platform, scope, metric);
  else q.run('DELETE FROM metric_resolution WHERE platform = ? AND canonical = ?', platform, metric);
}

/** metric_resolution row for (platform, scope, canonical) as { apiName, status, reason, updatedAt } or null. */
export function getMetricResolution(platform, scope, canonical) {
  const row = q.get(
    'SELECT api_name AS apiName, status, reason, updated_at AS updatedAt FROM metric_resolution WHERE platform = ? AND scope = ? AND canonical = ?',
    platform, scope, canonical,
  );
  return row || null;
}

/** Stores the API metric name that works for a canonical metric (status 'ok'). */
export function resolveMetric(platform, scope, canonical, apiName) {
  q.run(
    `INSERT INTO metric_resolution (platform, scope, canonical, api_name, status, reason, updated_at) VALUES (?, ?, ?, ?, 'ok', NULL, ?)
     ON CONFLICT(platform, scope, canonical) DO UPDATE SET api_name = excluded.api_name, status = 'ok', reason = NULL, updated_at = excluded.updated_at`,
    platform, scope, canonical, apiName, Date.now(),
  );
}

/** Marks a canonical metric as unsupported (every candidate failed). */
export function markUnsupported(platform, scope, canonical, reason) {
  q.run(
    `INSERT INTO metric_resolution (platform, scope, canonical, api_name, status, reason, updated_at) VALUES (?, ?, ?, NULL, 'unsupported', ?, ?)
     ON CONFLICT(platform, scope, canonical) DO UPDATE SET api_name = NULL, status = 'unsupported', reason = excluded.reason, updated_at = excluded.updated_at`,
    platform, scope, canonical, String(reason ?? '').slice(0, 500), Date.now(),
  );
}

/** All metric_resolution rows, optionally for one platform. */
export function listMetricResolution(platform) {
  const sql = `SELECT platform, scope, canonical, api_name AS apiName, status, reason, updated_at AS updatedAt FROM metric_resolution
    ${platform ? 'WHERE platform = ?' : ''} ORDER BY platform, scope, canonical`;
  return platform ? q.all(sql, platform) : q.all(sql);
}
