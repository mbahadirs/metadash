import { q } from '../index.js';

/**
 * Daily API unit ledger (api_quota, migration 011). `provider` is a free key such as 'youtube:<clientIdHash>';
 * `day` is the provider's quota day (YouTube: the Pacific-time date, computed by the provider's quota.js).
 */
export function addQuotaUnits(provider, day, units) {
  q.run(
    'INSERT INTO api_quota (provider, day, units) VALUES (?, ?, ?) ON CONFLICT(provider, day) DO UPDATE SET units = units + excluded.units',
    provider, day, Math.max(0, Math.round(units)),
  );
  return quotaUsed(provider, day);
}

export function quotaUsed(provider, day) {
  return q.get('SELECT units FROM api_quota WHERE provider = ? AND day = ?', provider, day)?.units ?? 0;
}

/** Drops ledger rows older than `keepDays` days (by day string order). */
export function pruneQuota(beforeDay) {
  q.run('DELETE FROM api_quota WHERE day < ?', beforeDay);
}
