import crypto from 'node:crypto';
import { addQuotaUnits, quotaUsed, pruneQuota } from '../../db/queries/quota.js';
import { getSetting } from '../../db/queries/settings.js';
import { msg } from '../../i18n.js';

/**
 * YouTube Data API v3 quota ledger (api_quota, migration 011). Confirmed (developers.google.com/youtube/v3/
 * determine_quota_cost, 2026-09): default 10,000 units/day per Google Cloud project, reset at midnight Pacific Time;
 * list calls (channels, playlistItems, videos, commentThreads, comments) cost 1 unit, comments.insert and
 * comments.setModerationStatus 50; every request — including invalid ones — costs at least 1 unit.
 * The YouTube Analytics API has its own quota and is not counted here.
 *
 * Policy: reads stop at min(90 % of the limit, limit − 500) so 500 units always stay free for inbox replies;
 * writes may use the whole limit. The ledger key is per OAuth client (= per Cloud project): 'youtube:<sha256(clientId)[:12]>'.
 */
export const DEFAULT_DAILY_LIMIT = 10_000;
export const READ_STOP_RATIO = 0.9;
export const REPLY_RESERVE = 500;
export const UNIT_COST = Object.freeze({ list: 1, insert: 50, moderate: 50 });
export const SETTING_QUOTA_LIMIT = 'youtube.quotaLimit';
const PT = 'America/Los_Angeles';
const DAY = 86_400_000;

export class QuotaError extends Error {
  constructor(message = msg('yt_quota_exhausted'), extra = {}) {
    super(message);
    this.name = 'QuotaError';
    this.code = 'YT_QUOTA';
    Object.assign(this, extra);
  }
}

/** Ledger key of an OAuth client id (never stores the id itself). */
export function quotaKeyFor(clientId) {
  return `youtube:${crypto.createHash('sha256').update(String(clientId ?? '')).digest('hex').slice(0, 12)}`;
}

const ptParts = (ms) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: PT, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(new Date(ms)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));

/** Quota day (Pacific date, 'YYYY-MM-DD') of an instant. */
export function ptDay(nowMs = Date.now()) {
  const p = ptParts(nowMs);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Epoch ms of the next Pacific midnight after `nowMs` (DST-safe: steps by the PT wall clock). */
export function nextResetAt(nowMs = Date.now()) {
  const p = ptParts(nowMs);
  const elapsed = ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 + (nowMs % 1000);
  let guess = nowMs - elapsed + DAY;
  // DST days are 23/25 h: nudge until the PT clock reads 00:00 of the next day.
  for (let i = 0; i < 3; i += 1) {
    const q = ptParts(guess);
    const off = ((q.hour >= 12 ? q.hour - 24 : q.hour) * 60 + q.minute) * 60_000 + q.second * 1000;
    if (off === 0) break;
    guess -= off;
  }
  return guess;
}

export function quotaLimit() {
  const v = Number(getSetting(SETTING_QUOTA_LIMIT, null));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_DAILY_LIMIT;
}

/** Highest ledger value reads may reach. */
export const readBudget = (limit = quotaLimit()) => Math.max(0, Math.min(Math.floor(limit * READ_STOP_RATIO), limit - REPLY_RESERVE));

/**
 * Books `units` before a Data API call. Throws QuotaError (nothing booked) when the call would pass the read budget
 * (reads) or the daily limit (writes). Returns the new total.
 */
export function spendUnits(key, units, { write = false, now = Date.now() } = {}) {
  if (!key || !units) return 0;
  const day = ptDay(now);
  const limit = quotaLimit();
  const used = quotaUsed(key, day);
  const cap = write ? limit : readBudget(limit);
  if (used + units > cap) throw new QuotaError(msg(write ? 'yt_quota_write_blocked' : 'yt_quota_exhausted'), { used, limit, resetsAt: nextResetAt(now) });
  return addQuotaUnits(key, day, units);
}

/** Google said quotaExceeded: mark the day as used up so later jobs stop before calling. */
export function markExhausted(key, now = Date.now()) {
  if (!key) return;
  const day = ptDay(now);
  const gap = quotaLimit() - quotaUsed(key, day);
  if (gap > 0) addQuotaUnits(key, day, gap);
}

export function quotaState(key, now = Date.now()) {
  return { used: key ? quotaUsed(key, ptDay(now)) : 0, limit: quotaLimit(), resetsAt: nextResetAt(now) };
}

/** Units a sync of `videos` uploads needs: channel + (playlist page + videos batch) per 50 + one comment page per inbox video. */
export function estimateSyncUnits(videos, { inboxVideos = 0 } = {}) {
  return 1 + Math.ceil(Math.max(0, videos) / 50) * 2 + Math.max(0, inboxVideos);
}

/** Drops ledger rows older than a week. */
export function pruneOldQuota(now = Date.now()) {
  pruneQuota(ptDay(now - 7 * DAY));
}
