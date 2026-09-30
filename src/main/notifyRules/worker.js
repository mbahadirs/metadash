import { q } from '../db/index.js';
import { getSetting } from '../db/queries/settings.js';
import { msg } from '../i18n.js';

/**
 * Notification rule "worker" (self-hosted publish worker): items that failed or were missed on the worker, the worker
 * unreachable for a long time while posts are waiting on it, and worker tokens that are invalid or about to expire.
 * One note per check, most urgent first. Preference key notify.worker; route /planner (tokens: /settings).
 */
const DAY_MS = 86_400_000;
const RECENT_MS = 7 * DAY_MS;
const OFFLINE_MS = 6 * 3_600_000;
const TOKEN_WARN_MS = 7 * DAY_MS;

export const rule = {
  type: 'worker',
  cooldownMs: DAY_MS,

  /** Impure read (notifications.js calls it only when notify.worker is on). */
  gather(now) {
    const failures = q.all(
      `SELECT t.id, t.worker_status AS status, t.worker_synced_at AS at, p.ref, a.username FROM planner_targets t
         JOIN planner_posts p ON p.id = t.post_id LEFT JOIN accounts a ON a.ig_id = t.account_id
       WHERE t.executor = 'worker' AND t.worker_status IN ('failed', 'missed') AND p.deleted_at IS NULL AND COALESCE(t.worker_synced_at, 0) >= ?`,
      now - RECENT_MS,
    );
    const waiting = q.get("SELECT COUNT(*) AS n FROM planner_targets t JOIN planner_posts p ON p.id = t.post_id WHERE t.executor = 'worker' AND p.deleted_at IS NULL AND t.state IN ('queued', 'ready')").n;
    const tokens = q.all('SELECT token_key AS tokenKey, account_id AS accountId, platform, expires_at AS expiresAt, status FROM worker_tokens');
    return {
      worker: {
        enabled: getSetting('worker.enabled', false) === true && !!getSetting('worker.url', null),
        lastSyncAt: getSetting('worker.lastSyncAt', null),
        lastError: getSetting('worker.lastError', null),
        waiting,
        failures,
        tokens,
      },
    };
  },

  /** Pure: data → note | null. */
  pick(data, { now, lang, sent, wasSent, nameList, cooldownMs }) {
    const w = data?.worker;
    if (!w?.enabled) return null;
    const fresh = (w.failures ?? []).map((f) => ({ key: `worker:${f.status}:${f.id}`, name: f.ref ? `${f.ref}${f.username ? ` @${f.username}` : ''}` : `#${f.id}` }))
      .filter((c) => !wasSent(sent, c.key, now, cooldownMs));
    if (fresh.length) {
      const names = nameList(fresh.map((c) => c.name), lang);
      const body = fresh.length === 1 ? msg('worker_notify_failed_one', { names }, lang) : msg('worker_notify_failed_many', { n: fresh.length, names }, lang);
      return { type: 'worker', key: fresh[0].key, keys: fresh.map((c) => c.key), title: msg('worker_notify_title', null, lang), body, route: '/planner' };
    }
    if (w.waiting > 0 && w.lastError && w.lastSyncAt != null && now - w.lastSyncAt > OFFLINE_MS) {
      const key = `worker:offline:${new Date(w.lastSyncAt).toISOString().slice(0, 10)}`;
      if (!wasSent(sent, key, now, cooldownMs)) {
        return { type: 'worker', key, keys: [key], title: msg('worker_notify_title', null, lang), body: msg('worker_notify_offline', { n: w.waiting }, lang), route: '/settings' };
      }
    }
    const bad = (w.tokens ?? []).filter((t) => t.status === 'invalid' || t.status === 'missing' || (t.expiresAt != null && t.expiresAt - now < TOKEN_WARN_MS))
      .map((t) => ({ key: `worker:token:${t.tokenKey}:${t.expiresAt ?? t.status}`, name: t.tokenKey }))
      .filter((c) => !wasSent(sent, c.key, now, cooldownMs));
    if (bad.length) {
      return { type: 'worker', key: bad[0].key, keys: bad.map((c) => c.key), title: msg('worker_notify_title', null, lang), body: msg('worker_notify_tokens', { names: nameList(bad.map((c) => c.name), lang) }, lang), route: '/settings' };
    }
    return null;
  },
};
