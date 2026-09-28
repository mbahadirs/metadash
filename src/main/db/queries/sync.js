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

export function logError(runId, { igId, endpoint, code, message }) {
  q.run('INSERT INTO sync_errors (run_id, ig_id, endpoint, code, message, at) VALUES (?, ?, ?, ?, ?, ?)',
    runId, igId ?? null, endpoint ?? null, code ?? null, String(message ?? '').slice(0, 500), Date.now());
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
    `SELECT e.id, e.run_id AS runId, e.ig_id AS igId, a.username, e.endpoint, e.code, e.message, e.at
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

export function listDisabledMetrics() {
  return q.all('SELECT metric, scope, reason, disabled_at AS disabledAt FROM disabled_metrics ORDER BY disabled_at DESC');
}

export function disableMetric(metric, scope, reason) {
  q.run(
    `INSERT INTO disabled_metrics (metric, scope, reason, disabled_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(metric) DO UPDATE SET reason = excluded.reason, disabled_at = excluded.disabled_at`,
    metric, scope, reason, Date.now(),
  );
}

export function enableMetric(metric) {
  q.run('DELETE FROM disabled_metrics WHERE metric = ?', metric);
}
