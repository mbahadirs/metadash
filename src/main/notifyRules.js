import { msg } from './i18n.js';

/** Pure notification rules (no Electron imports, unit-tested). notifications.js gathers data and shows them. */
export const DAY_MS = 86_400_000;
export const SENT_MAX_AGE_MS = 30 * DAY_MS;
export const NOTIFY_TYPES = ['anomalies', 'budget', 'silent', 'token'];

/** Per-key cooldowns. Keys embed the anomaly date / budget month / token expiry, so these mostly guard re-runs. */
const COOLDOWN_MS = { anomalies: 3 * DAY_MS, budget: 28 * DAY_MS, silent: 7 * DAY_MS, token: DAY_MS };
const ANOMALY_LOOKBACK_DAYS = 2;
const BUDGET_THRESHOLD = 0.9;
const SILENT_DAYS = 7;
const TOKEN_WARN_DAYS = 7;
const TOKEN_EXPIRED_GRACE_DAYS = 30;
const MAX_NAMES = 3;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function wasSent(sent, key, now, cooldown) {
  const at = Date.parse(sent?.[key] ?? '');
  return Number.isFinite(at) && now - at < cooldown;
}

function nameList(names, lang) {
  const shown = names.slice(0, MAX_NAMES).join(', ');
  return names.length > MAX_NAMES ? `${shown} ${msg('notify_more', { n: names.length - MAX_NAMES }, lang)}` : shown;
}

/** Summary notification for per-item candidates [{ key, name }] that are not in cooldown. */
function summary({ type, candidates, sent, now, lang, route, one, many }) {
  const fresh = candidates.filter((c) => !wasSent(sent, c.key, now, COOLDOWN_MS[type]));
  if (!fresh.length) return null;
  const names = nameList(fresh.map((c) => c.name), lang);
  const body = fresh.length === 1 ? one(fresh[0], names) : msg(many, { n: fresh.length, names }, lang);
  return { type, key: fresh[0].key, keys: fresh.map((c) => c.key), title: msg(`notify_${type}_title`, null, lang), body, route };
}

function anomalyNote({ anomalies = [] }, ctx) {
  const cutoff = ymd(ctx.now - ANOMALY_LOOKBACK_DAYS * DAY_MS);
  const latest = new Map();
  for (const a of anomalies) if (a.date >= cutoff && (!latest.has(a.igId) || a.date > latest.get(a.igId).date)) latest.set(a.igId, a);
  const candidates = [...latest.values()].map((a) => ({ key: `anomaly:${a.igId}:${a.date}`, name: `@${a.username}` }));
  return summary({ ...ctx, type: 'anomalies', candidates, route: '/', many: 'notify_anomalies_many', one: (_c, names) => msg('notify_anomalies_one', { names }, ctx.lang) });
}

function budgetNote({ budgets = [] }, ctx) {
  const month = ymd(ctx.now).slice(0, 7);
  const candidates = budgets
    .filter((b) => b.budget > 0 && b.spentMtd / b.budget >= BUDGET_THRESHOLD)
    .map((b) => ({ key: `budget:${b.actId}:${month}`, name: b.name ?? b.actId, pct: Math.round((b.spentMtd / b.budget) * 100) }));
  return summary({ ...ctx, type: 'budget', candidates, route: '/ads', many: 'notify_budget_many', one: (c) => msg('notify_budget_one', { name: c.name, pct: c.pct }, ctx.lang) });
}

function silentNote({ silent = [] }, ctx) {
  const candidates = silent
    .filter((s) => s.daysSincePost != null && s.daysSincePost >= SILENT_DAYS)
    .map((s) => ({ key: `silent:${s.igId}`, name: `@${s.username}`, days: s.daysSincePost }));
  return summary({ ...ctx, type: 'silent', candidates, route: '/', many: 'notify_silent_many', one: (c) => msg('notify_silent_one', { names: c.name, days: c.days }, ctx.lang) });
}

function tokenNote({ token }, { now, sent, lang }) {
  const expiresAt = Number(token?.expiresAt);
  if (!token?.expiresAt || !Number.isFinite(expiresAt)) return null;
  const msLeft = expiresAt - now;
  if (msLeft > TOKEN_WARN_DAYS * DAY_MS || msLeft < -TOKEN_EXPIRED_GRACE_DAYS * DAY_MS) return null;
  const key = `token:${ymd(expiresAt)}`;
  if (wasSent(sent, key, now, COOLDOWN_MS.token)) return null;
  const days = Math.ceil(msLeft / DAY_MS);
  const body = msLeft <= 0 ? msg('notify_token_expired', null, lang) : days <= 1 ? msg('notify_token_body_one', null, lang) : msg('notify_token_body', { days }, lang);
  return { type: 'token', key, keys: [key], title: msg('notify_token_title', null, lang), body, route: '/settings' };
}

const RULES = { anomalies: anomalyNote, budget: budgetNote, silent: silentNote, token: tokenNote };

/**
 * Decides which desktop notifications to show.
 * data: { demo?, anomalies: [{igId, username, date}], budgets: [{actId, name, budget, spentMtd}], silent: [{igId, username, daysSincePost}], token: {expiresAt}|null }
 * sent: { key: ISO timestamp } · prefs: { enabled, anomalies, budget, silent, token } (missing = on)
 * → [{ type, key, keys, title, body, route }]
 */
export function pickNotifications({ now, lang = 'en', data = {}, sent = {}, prefs = {} }) {
  if (data.demo || prefs.enabled === false) return [];
  const ctx = { now, lang, sent };
  return NOTIFY_TYPES.filter((type) => prefs[type] !== false).map((type) => RULES[type](data, ctx)).filter(Boolean);
}

/** Drops sent-log entries older than maxAge (or unparseable); returns a new object. */
export function pruneSent(sent, now, maxAge = SENT_MAX_AGE_MS) {
  return Object.fromEntries(Object.entries(sent ?? {}).filter(([, at]) => { const t = Date.parse(at); return Number.isFinite(t) && now - t <= maxAge; }));
}

/** Returns a new sent log with every key of the given notifications stamped at `now`. */
export function markSent(sent, notes, now) {
  const at = new Date(now).toISOString();
  return { ...sent, ...Object.fromEntries(notes.flatMap((n) => n.keys ?? [n.key]).map((k) => [k, at])) };
}
