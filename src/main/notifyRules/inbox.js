import { msg } from '../i18n.js';
import { q } from '../db/index.js';
import { inboxSettings } from '../inbox/settings.js';

/**
 * Notification rule "inbox" (v2.0 chunk D), preference key notify.inbox (missing = on), route /inbox.
 *  - Overdue: "N comments are waiting longer than the reply target" (inbox.slaHours), at most once per day per count
 *    band (key inbox:overdue:<day>, cooldown 20 h).
 *  - New: "N new comments waiting for a reply" for open comments of the last 6 hours, at most once per 6-hour window.
 * gather() reads the DB (impure); pick() is pure. The overdue note wins when both apply.
 */
const HOUR = 3_600_000;
export const NEW_WINDOW_MS = 6 * HOUR;
const COOLDOWN_MS = 20 * HOUR;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** { inbox: { overdue, overdueAccounts: [username], fresh, slaHours } } */
export function gatherInbox(now, { query = q, settings = inboxSettings } = {}) {
  const run = query;
  const { slaHours } = settings();
  const since = now - slaHours * HOUR;
  const overdue = run.all(
    `SELECT a.username, COUNT(*) AS n FROM comments c
     JOIN media m ON m.media_id = c.media_id JOIN accounts a ON a.ig_id = COALESCE(c.account_id, m.ig_id)
     LEFT JOIN inbox_state s ON s.comment_id = c.comment_id
     WHERE c.parent_id IS NULL AND c.is_from_owner = 0 AND a.is_tracked = 1 AND COALESCE(m.is_deleted, 0) = 0
       AND c.created_at < ? AND c.created_at >= ? AND COALESCE(s.status, 'open') = 'open'
       AND NOT EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.comment_id AND r.is_from_owner = 1)
     GROUP BY a.ig_id ORDER BY n DESC`,
    since, now - 30 * 24 * HOUR,
  );
  const fresh = run.get(
    `SELECT COUNT(*) AS n FROM comments c
     JOIN media m ON m.media_id = c.media_id JOIN accounts a ON a.ig_id = COALESCE(c.account_id, m.ig_id)
     LEFT JOIN inbox_state s ON s.comment_id = c.comment_id
     WHERE c.parent_id IS NULL AND c.is_from_owner = 0 AND a.is_tracked = 1 AND c.created_at >= ?
       AND COALESCE(s.status, 'open') = 'open'
       AND NOT EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.comment_id AND r.is_from_owner = 1)`,
    now - NEW_WINDOW_MS,
  )?.n ?? 0;
  return {
    inbox: {
      overdue: overdue.reduce((s, r) => s + r.n, 0),
      overdueAccounts: overdue.map((r) => `@${r.username}`),
      fresh,
      slaHours,
    },
  };
}

/** Pure: data from gatherInbox + ctx { now, lang, sent, wasSent, nameList, cooldownMs } → note | null. */
export function pickInbox(data, ctx) {
  const d = data?.inbox;
  if (!d) return null;
  if (d.overdue > 0) {
    const key = `inbox:overdue:${ymd(ctx.now)}`;
    if (!ctx.wasSent(ctx.sent, key, ctx.now, COOLDOWN_MS)) {
      const names = ctx.nameList(d.overdueAccounts ?? [], ctx.lang);
      return {
        type: 'inbox', key, keys: [key], route: '/inbox',
        title: msg('inbox_notify_title', null, ctx.lang),
        body: msg(d.overdue === 1 ? 'inbox_notify_overdue_one' : 'inbox_notify_overdue', { n: d.overdue, hours: d.slaHours, names }, ctx.lang),
      };
    }
  }
  if (d.fresh > 0) {
    const key = `inbox:new:${Math.floor(ctx.now / NEW_WINDOW_MS)}`;
    if (ctx.wasSent(ctx.sent, key, ctx.now, NEW_WINDOW_MS)) return null;
    return {
      type: 'inbox', key, keys: [key], route: '/inbox',
      title: msg('inbox_notify_title', null, ctx.lang),
      body: msg(d.fresh === 1 ? 'inbox_notify_new_one' : 'inbox_notify_new', { n: d.fresh }, ctx.lang),
    };
  }
  return null;
}

export const rule = {
  type: 'inbox',
  cooldownMs: COOLDOWN_MS,
  gather: (now) => gatherInbox(now),
  pick: pickInbox,
};
