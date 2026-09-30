import { q } from '../index.js';
import { upsertComment } from './media.js';
import { listAccounts, hasAccountScope } from './accounts.js';

/**
 * Unified inbox queries (v2.0 chunk D) on top of migration 012: comments (+platform/account columns), inbox_state
 * (workflow status, first response, sentiment), inbox_cursor (poll bookkeeping) and comment_replies as the reply outbox
 * (statuses suggested | edited | sending | sent | failed | dismissed; the outbox view shows sending/sent/failed).
 *
 * Inbox items are top-level comments from other people (parent_id IS NULL, is_from_owner = 0). "Answered" is the same
 * as v1.5/commentStats: an owner reply (is_from_owner = 1) whose parent_id is the comment. The effective status is
 * done/ignored when set by the user, else replied when answered (or marked replied), else open.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const LIST_LIMIT_MAX = 200;
export const STATUSES = Object.freeze(['open', 'replied', 'done', 'ignored']);
export const SENTIMENTS = Object.freeze(['positive', 'neutral', 'negative', 'question', 'complaint', 'spam']);
export const OUTBOX_STATUSES = Object.freeze(['sending', 'sent', 'failed']);

/** Tables chunk D adds to the demo reset (seed/index.js clearAll). */
export const INBOX_TABLES = Object.freeze(['inbox_state', 'inbox_cursor']);

const OWNER_REPLY = 'EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.comment_id AND r.is_from_owner = 1)';
const FIRST_REPLY = '(SELECT MIN(r.created_at) FROM comments r WHERE r.parent_id = c.comment_id AND r.is_from_owner = 1)';
const STATUS_SQL = `CASE WHEN s.status IN ('done', 'ignored') THEN s.status WHEN s.status = 'replied' OR ${OWNER_REPLY} THEN 'replied' ELSE 'open' END`;
const FROM_SQL = `FROM comments c
  JOIN media m ON m.media_id = c.media_id
  JOIN accounts a ON a.ig_id = COALESCE(c.account_id, m.ig_id)
  LEFT JOIN inbox_state s ON s.comment_id = c.comment_id
  LEFT JOIN brand_voice bv ON bv.account_id = a.ig_id`;
const ROW_SQL = `SELECT c.*, a.ig_id AS acc_id, a.platform AS acc_platform, a.username AS account_username,
    m.caption, m.permalink AS post_permalink, m.thumbnail_path, m.media_type, m.media_product_type,
    s.assignee, s.is_question, s.sentiment, s.first_response_at, COALESCE(bv.ai_disabled, 0) AS ai_disabled,
    ${STATUS_SQL} AS st, (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.comment_id) AS reply_count`;
const TOP_LEVEL = ['c.parent_id IS NULL', 'c.is_from_owner = 0', 'COALESCE(m.is_deleted, 0) = 0'];

const ph = (list) => list.map(() => '?').join(',');
const toStr = (list) => list.map((v) => String(v));

function mapRow(r, { now = Date.now(), slaMs = DAY } = {}) {
  const status = r.st ?? 'open';
  return {
    commentId: r.comment_id,
    externalId: r.external_id ?? r.comment_id,
    mediaId: r.media_id,
    accountId: r.acc_id ?? r.account_id,
    platform: r.platform ?? r.acc_platform ?? 'instagram',
    accountUsername: r.account_username ?? '',
    username: r.username ?? '',
    authorId: r.author_id ?? null,
    text: r.text ?? '',
    createdAt: r.created_at,
    likeCount: r.like_count ?? 0,
    permalink: r.permalink ?? null,
    isHidden: r.is_hidden === 1,
    post: { caption: r.caption ?? null, permalink: r.post_permalink ?? null, thumb: r.thumbnail_path ?? null, mediaType: r.media_type ?? null, mediaProductType: r.media_product_type ?? null },
    status,
    assignee: r.assignee ?? null,
    firstResponseAt: r.first_response_at ?? null,
    overdue: status === 'open' && now - r.created_at > slaMs,
    isQuestion: r.is_question === 1,
    sentiment: r.sentiment ?? null,
    replies: r.reply_count ?? 0,
    aiDisabled: r.ai_disabled === 1,
  };
}

// ---------------------------------------------------------------- cursor encoding

export function encodeCursor(createdAt, commentId) {
  return Buffer.from(JSON.stringify([createdAt, commentId]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || !cursor || cursor.length > 400) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(v) && Number.isFinite(v[0]) && typeof v[1] === 'string' ? { createdAt: v[0], commentId: v[1] } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- filters

const dateMs = (d, endOfDay) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
  return Number.isFinite(t) ? t : null;
};
const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** WHERE parts shared by list and counts (everything except status and the keyset cursor). */
function filterSql(f = {}) {
  const where = [...TOP_LEVEL, 'a.is_tracked = 1'];
  const params = [];
  if (f.platforms?.length) { where.push(`COALESCE(c.platform, a.platform) IN (${ph(f.platforms)})`); params.push(...toStr(f.platforms)); }
  if (f.accountIds?.length) { where.push(`a.ig_id IN (${ph(f.accountIds)})`); params.push(...toStr(f.accountIds)); }
  if (hasAccountScope()) {
    const allowed = listAccounts({ onlyTracked: false }).map((a) => a.igId);
    where.push(allowed.length ? `a.ig_id IN (${ph(allowed)})` : '0');
    params.push(...allowed);
  }
  if (f.sentiment?.length) { where.push(`s.sentiment IN (${ph(f.sentiment)})`); params.push(...toStr(f.sentiment)); }
  if (f.assignee === null) where.push('s.assignee IS NULL');
  else if (typeof f.assignee === 'string' && f.assignee) { where.push('s.assignee = ?'); params.push(f.assignee); }
  if (f.question === true) where.push('s.is_question = 1');
  if (typeof f.q === 'string' && f.q.trim()) {
    const like = `%${likeEscape(f.q.trim().slice(0, 100))}%`;
    where.push("(c.text LIKE ? ESCAPE '\\' OR c.username LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  const from = dateMs(f.from, false);
  const to = dateMs(f.to, true);
  if (from != null) { where.push('c.created_at >= ?'); params.push(from); }
  if (to != null) { where.push('c.created_at <= ?'); params.push(to); }
  return { where, params };
}

function statusSql(status, { now, slaMs }) {
  switch (status) {
    case 'all': return { sql: null, params: [] };
    case 'overdue': return { sql: "st = 'open' AND created_at < ?", params: [now - slaMs] };
    case 'replied': case 'done': case 'ignored': return { sql: 'st = ?', params: [status] };
    case 'open': case 'unanswered': default: return { sql: "st = 'open'", params: [] };
  }
}

/**
 * Keyset-paginated inbox list. filters: { status (open|unanswered|replied|done|ignored|overdue|all; default open),
 * platforms, accountIds, sentiment[], assignee (string | null = unassigned), question, q, from, to (YYYY-MM-DD),
 * sort (newest|oldest|overdue), limit, cursor }. opts: { now, slaHours }.
 * → { items, nextCursor, counts: { open, replied, done, overdue } }
 */
export function listInbox(filters = {}, cursorArg, { now = Date.now(), slaHours = 24 } = {}) {
  const slaMs = slaHours * HOUR;
  const { where, params } = filterSql(filters);
  const st = statusSql(filters.status, { now, slaMs });
  const asc = filters.sort === 'oldest' || filters.sort === 'overdue';
  const outer = st.sql ? [st.sql] : [];
  const outerParams = [...st.params];
  const cur = decodeCursor(cursorArg ?? filters.cursor);
  if (cur) {
    outer.push(asc ? '(created_at > ? OR (created_at = ? AND comment_id > ?))' : '(created_at < ? OR (created_at = ? AND comment_id < ?))');
    outerParams.push(cur.createdAt, cur.createdAt, cur.commentId);
  }
  const limit = Math.min(Math.max(1, Math.trunc(Number(filters.limit) || 50)), LIST_LIMIT_MAX);
  const dir = asc ? 'ASC' : 'DESC';
  const rows = q.all(
    `SELECT * FROM (${ROW_SQL} ${FROM_SQL} WHERE ${where.join(' AND ')})
     ${outer.length ? `WHERE ${outer.join(' AND ')}` : ''}
     ORDER BY created_at ${dir}, comment_id ${dir} LIMIT ${limit + 1}`,
    ...params, ...outerParams,
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => mapRow(r, { now, slaMs })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.comment_id) : null,
    counts: inboxCounts(filters, { now, slaHours }),
  };
}

/** { open, replied, done (done + ignored), overdue } for the filters (status and cursor ignored). */
export function inboxCounts(filters = {}, { now = Date.now(), slaHours = 24 } = {}) {
  const { where, params } = filterSql(filters);
  const r = q.get(
    `SELECT SUM(st = 'open') AS open, SUM(st = 'replied') AS replied, SUM(st IN ('done', 'ignored')) AS done,
       SUM(st = 'open' AND created_at < ?) AS overdue
     FROM (SELECT c.created_at, ${STATUS_SQL} AS st ${FROM_SQL} WHERE ${where.join(' AND ')})`,
    now - slaHours * HOUR, ...params,
  );
  return { open: r?.open ?? 0, replied: r?.replied ?? 0, done: r?.done ?? 0, overdue: r?.overdue ?? 0 };
}

/** One inbox row by key (any comment, used for thread roots), or null. */
export function getInboxRow(commentId, opts = {}) {
  const r = q.get(`${ROW_SQL} ${FROM_SQL} WHERE c.comment_id = ?`, String(commentId));
  return r ? mapRow(r, { now: opts.now, slaMs: (opts.slaHours ?? 24) * HOUR }) : null;
}

/** { root, replies (oldest first, with isFromOwner), outbox } or null. A reply key resolves to its top-level comment. */
export function thread(commentId, opts = {}) {
  const base = q.get('SELECT comment_id, parent_id FROM comments WHERE comment_id = ?', String(commentId));
  if (!base) return null;
  const rootId = base.parent_id ?? base.comment_id;
  const root = getInboxRow(rootId, opts);
  if (!root) return null;
  const replies = q.all(`${ROW_SQL} ${FROM_SQL} WHERE c.parent_id = ? ORDER BY c.created_at, c.comment_id`, rootId)
    .map((r) => ({ ...mapRow(r, { now: opts.now, slaMs: (opts.slaHours ?? 24) * HOUR }), isFromOwner: r.is_from_owner === 1 }));
  return { root, replies, outbox: outboxFor(rootId) };
}

// ---------------------------------------------------------------- workflow state

function existingIds(commentIds) {
  const ids = [...new Set((commentIds ?? []).map(String))];
  if (!ids.length) return [];
  return q.all(`SELECT comment_id FROM comments WHERE comment_id IN (${ph(ids)})`, ...ids).map((r) => r.comment_id);
}

/** Sets the workflow status of top-level comments; returns the number of rows written. */
export function setStatus(commentIds, status, { by = null, at = Date.now() } = {}) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error(`bad status ${status}`), { code: 'BAD_STATUS' });
  const ids = existingIds(commentIds);
  q.tx(() => {
    for (const id of ids) {
      q.run(
        `INSERT INTO inbox_state (comment_id, status, status_by, status_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(comment_id) DO UPDATE SET status = excluded.status, status_by = excluded.status_by, status_at = excluded.status_at`,
        id, status, by, at,
      );
    }
  })();
  return ids.length;
}

export function assign(commentIds, assignee, { by = null, at = Date.now() } = {}) {
  const ids = existingIds(commentIds);
  const who = assignee == null || assignee === '' ? null : String(assignee);
  q.tx(() => {
    for (const id of ids) {
      q.run(
        `INSERT INTO inbox_state (comment_id, status, assignee, status_by, status_at) VALUES (?, 'open', ?, ?, ?)
         ON CONFLICT(comment_id) DO UPDATE SET assignee = excluded.assignee, status_by = excluded.status_by, status_at = excluded.status_at`,
        id, who, by, at,
      );
    }
  })();
  return ids.length;
}

/** Distinct assignees in use (for the filter). */
export function assignees() {
  return q.all('SELECT DISTINCT assignee FROM inbox_state WHERE assignee IS NOT NULL ORDER BY assignee').map((r) => r.assignee);
}

/** Creates the inbox_state row of an incoming top-level comment (is_question from the offline rule). */
export function ensureState(commentId, { isQuestion = false } = {}) {
  q.run(
    `INSERT INTO inbox_state (comment_id, status, is_question) VALUES (?, 'open', ?)
     ON CONFLICT(comment_id) DO UPDATE SET is_question = excluded.is_question`,
    String(commentId), isQuestion ? 1 : 0,
  );
}

/**
 * First-response bookkeeping: the earliest owner reply under each top-level comment sets first_response_at/minutes
 * and turns an 'open' comment into 'replied' (done/ignored stay). source: 'platform' (seen in a poll) | 'app'.
 * The source of an already recorded first response is kept (an app reply later seen by a poll stays 'app').
 */
export function refreshFirstResponse(parentIds, { source = 'platform' } = {}) {
  let n = 0;
  for (const id of new Set((parentIds ?? []).filter(Boolean).map(String))) {
    const row = q.get(`SELECT c.created_at AS created, ${FIRST_REPLY} AS fr FROM comments c WHERE c.comment_id = ? AND c.parent_id IS NULL AND c.is_from_owner = 0`, id);
    if (!row || row.fr == null) continue;
    const minutes = Math.max(0, Math.round((row.fr - row.created) / MINUTE));
    q.run(
      `INSERT INTO inbox_state (comment_id, status, first_response_at, first_response_minutes, first_response_source) VALUES (?, 'replied', ?, ?, ?)
       ON CONFLICT(comment_id) DO UPDATE SET
         first_response_source = CASE WHEN inbox_state.first_response_at = excluded.first_response_at AND inbox_state.first_response_source IS NOT NULL
           THEN inbox_state.first_response_source ELSE excluded.first_response_source END,
         first_response_at = excluded.first_response_at, first_response_minutes = excluded.first_response_minutes,
         status = CASE WHEN inbox_state.status = 'open' THEN 'replied' ELSE inbox_state.status END`,
      id, row.fr, minutes, source,
    );
    n += 1;
  }
  return n;
}

export function setHidden(commentId, hidden) {
  return q.run('UPDATE comments SET is_hidden = ? WHERE comment_id = ?', hidden ? 1 : 0, String(commentId)).changes;
}

// ---------------------------------------------------------------- storing normalized comments

/**
 * Stores adapter output (NormalizedComment[] + optional isQuestion). A changed text clears the stored sentiment so it
 * is classified again; owner replies get their latency; first responses are refreshed. → { inserted, updated }
 */
export function upsertNormalized(comments, { fetchedAt = Date.now() } = {}) {
  let inserted = 0;
  let updated = 0;
  const created = new Map((comments ?? []).map((c) => [c.commentId, c.createdAt]));
  const parents = new Set();
  q.tx(() => {
    for (const c of comments ?? []) {
      const prev = q.get('SELECT text FROM comments WHERE comment_id = ?', c.commentId);
      if (prev) updated += 1; else inserted += 1;
      if (prev && prev.text !== c.text) q.run('UPDATE inbox_state SET sentiment = NULL, sentiment_score = NULL, sentiment_model = NULL, sentiment_at = NULL WHERE comment_id = ?', c.commentId);
      let replyLatencyMinutes = null;
      if (c.isFromOwner && c.parentId) {
        const parentAt = created.get(c.parentId) ?? q.get('SELECT created_at FROM comments WHERE comment_id = ?', c.parentId)?.created_at;
        if (Number.isFinite(parentAt)) replyLatencyMinutes = Math.max(0, Math.round((c.createdAt - parentAt) / MINUTE));
        parents.add(c.parentId);
      }
      upsertComment({ ...c, replyLatencyMinutes, fetchedAt: c.fetchedAt ?? fetchedAt });
      if (!c.parentId && !c.isFromOwner) ensureState(c.commentId, { isQuestion: !!c.isQuestion });
    }
    refreshFirstResponse([...parents]);
  })();
  return { inserted, updated };
}

// ---------------------------------------------------------------- SLA / stats

/**
 * Top-level incoming comments with their first owner reply: [{ commentId, accountId, platform, createdAt,
 * firstResponseAt, status }]. Range: fromMs/toMs (epoch) or from/to (YYYY-MM-DD). Done/ignored comments that were
 * never answered are left out (closed without needing a reply).
 */
export function slaRows({ from, to, fromMs, toMs, accountIds, platforms, trackedOnly = true } = {}) {
  const where = [...TOP_LEVEL];
  const params = [];
  if (trackedOnly) where.push('a.is_tracked = 1');
  const lo = Number.isFinite(fromMs) ? fromMs : dateMs(from, false);
  const hi = Number.isFinite(toMs) ? toMs : dateMs(to, true);
  if (lo != null) { where.push('c.created_at >= ?'); params.push(lo); }
  if (hi != null) { where.push('c.created_at <= ?'); params.push(hi); }
  if (accountIds?.length) { where.push(`a.ig_id IN (${ph(accountIds)})`); params.push(...toStr(accountIds)); }
  if (platforms?.length) { where.push(`COALESCE(c.platform, a.platform) IN (${ph(platforms)})`); params.push(...toStr(platforms)); }
  return q.all(
    `SELECT * FROM (SELECT c.comment_id, a.ig_id AS account_id, COALESCE(c.platform, a.platform, 'instagram') AS platform, c.created_at,
       ${FIRST_REPLY} AS fr, ${STATUS_SQL} AS st ${FROM_SQL} WHERE ${where.join(' AND ')})
     WHERE NOT (st IN ('done', 'ignored') AND fr IS NULL)
     ORDER BY created_at`,
    ...params,
  ).map((r) => ({ commentId: r.comment_id, accountId: r.account_id, platform: r.platform, createdAt: r.created_at, firstResponseAt: r.fr ?? null, status: r.st }));
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Response stats of one account for the health score: incoming top-level comments (closed-without-reply excluded),
 * answered (owner reply exists), withinSla (first reply within slaHours), eligible (answered or older than the target)
 * and FRT median / mean in minutes. total = every stored comment in the window (as v1 commentStats).
 */
export function commentStatsV2(igId, fromMs, toMs, { slaHours = 24, now = Date.now() } = {}) {
  const rows = slaRows({ fromMs, toMs, accountIds: [igId], trackedOnly: false });
  const slaMs = slaHours * HOUR;
  const frt = rows.filter((r) => r.firstResponseAt != null).map((r) => Math.max(0, (r.firstResponseAt - r.createdAt) / MINUTE));
  const total = q.get('SELECT COUNT(*) AS n FROM comments c JOIN media m ON m.media_id = c.media_id WHERE m.ig_id = ? AND c.created_at BETWEEN ? AND ?', igId, fromMs, toMs)?.n ?? 0;
  const answered = frt.length;
  return {
    total,
    incoming: rows.length,
    answered,
    withinSla: frt.filter((m) => m * MINUTE <= slaMs).length,
    eligible: rows.filter((r) => r.firstResponseAt != null || now - r.createdAt >= slaMs).length,
    avgLatency: answered ? frt.reduce((s, m) => s + m, 0) / answered : null,
    medianFrtMin: median(frt),
  };
}

// ---------------------------------------------------------------- poll cursor

export function getCursor(accountId, mediaId) {
  const r = q.get('SELECT last_polled_at, last_comment_count FROM inbox_cursor WHERE account_id = ? AND media_id = ?', String(accountId), String(mediaId));
  return r ? { lastPolledAt: r.last_polled_at, lastCommentCount: r.last_comment_count } : null;
}

export function setCursor(accountId, mediaId, { lastPolledAt, lastCommentCount }) {
  q.run(
    `INSERT INTO inbox_cursor (account_id, media_id, last_polled_at, last_comment_count) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, media_id) DO UPDATE SET last_polled_at = excluded.last_polled_at, last_comment_count = excluded.last_comment_count`,
    String(accountId), String(mediaId), lastPolledAt ?? null, lastCommentCount ?? null,
  );
}

/**
 * Posts to poll for an account: every post of the last `lookbackDays`, plus older posts (up to `maxAgeDays`) whose
 * synced comment count (media_latest.comments) grew since the last poll. Stories are skipped. Newest first.
 */
export function pollCandidates(accountId, { now = Date.now(), lookbackDays = 14, maxAgeDays = 90, limit = 60 } = {}) {
  return q.all(
    `SELECT m.media_id, m.external_id, m.posted_at, l.comments AS comment_count, ic.last_polled_at, ic.last_comment_count
     FROM media m
     LEFT JOIN media_latest l ON l.media_id = m.media_id
     LEFT JOIN inbox_cursor ic ON ic.account_id = m.ig_id AND ic.media_id = m.media_id
     WHERE m.ig_id = ? AND COALESCE(m.is_deleted, 0) = 0 AND COALESCE(m.media_product_type, '') <> 'STORY' AND m.posted_at >= ?
       AND (m.posted_at >= ? OR (ic.last_comment_count IS NOT NULL AND COALESCE(l.comments, 0) > ic.last_comment_count))
     ORDER BY m.posted_at DESC LIMIT ?`,
    String(accountId), now - maxAgeDays * DAY, now - lookbackDays * DAY, limit,
  );
}

// ---------------------------------------------------------------- outbox (comment_replies)

function mapOutbox(r) {
  return {
    id: r.id, commentId: r.comment_id, body: r.sent_text ?? r.suggestion, status: r.status, remoteId: r.sent_reply_id ?? null,
    errorCode: r.error_code ?? null, error: r.error ?? null, attempts: r.attempts ?? 0, author: r.author ?? null,
    createdAt: r.created_at, sentAt: r.sent_at ?? null, sendingAt: r.sending_at ?? null, platform: r.platform ?? null, accountId: r.account_id ?? null,
  };
}

export function getOutbox(id) {
  const r = q.get('SELECT * FROM comment_replies WHERE id = ?', Number(id));
  return r ? mapOutbox(r) : null;
}

export function outboxFor(commentId) {
  return q.all(`SELECT * FROM comment_replies WHERE comment_id = ? AND status IN (${ph(OUTBOX_STATUSES)}) ORDER BY id`, String(commentId), ...OUTBOX_STATUSES).map(mapOutbox);
}

/** Starts a send attempt: a 'sending' row (the body is both suggestion and sent_text). → id */
export function beginSend({ commentId, accountId, platform, body, author = null, now = Date.now() }) {
  const res = q.run(
    `INSERT INTO comment_replies (comment_id, suggestion, status, sent_text, platform, account_id, attempts, author, sending_at, created_at)
     VALUES (?, ?, 'sending', ?, ?, ?, 1, ?, ?, ?)`,
    String(commentId), body, body, platform, accountId, author, now, now,
  );
  return Number(res.lastInsertRowid);
}

/** failed → sending (retry). Returns true when the row was failed and is now sending. */
export function restartSend(id, { now = Date.now() } = {}) {
  return q.run("UPDATE comment_replies SET status = 'sending', attempts = attempts + 1, sending_at = ?, error = NULL, error_code = NULL WHERE id = ? AND status = 'failed'", now, Number(id)).changes === 1;
}

export function markSent(id, { remoteId, at = Date.now() }) {
  q.run("UPDATE comment_replies SET status = 'sent', sent_reply_id = ?, sent_at = ?, error = NULL, error_code = NULL WHERE id = ?", remoteId ?? null, at, Number(id));
}

export function markFailed(id, { code = null, message = null } = {}) {
  q.run("UPDATE comment_replies SET status = 'failed', error_code = ?, error = ? WHERE id = ?", code == null ? null : String(code).slice(0, 60), message == null ? null : String(message).slice(0, 300), Number(id));
}

/** Owner reply under a comment created at/after `since` with exactly this text (crash recovery). */
export function ownerReplyWithText(parentId, text, since) {
  return q.get('SELECT comment_id, created_at FROM comments WHERE parent_id = ? AND is_from_owner = 1 AND text = ? AND created_at >= ? ORDER BY created_at LIMIT 1', String(parentId), text, since) ?? null;
}

// ---------------------------------------------------------------- sentiment

/**
 * Comments for AI classification: explicit ids, or (unclassified) incoming top-level comments without a sentiment.
 * Accounts that opted out of AI (brand_voice.ai_disabled) are always left out.
 */
export function classificationCandidates({ commentIds, unclassified = !commentIds?.length, accountIds, limit = 500 } = {}) {
  const where = [...TOP_LEVEL, 'COALESCE(bv.ai_disabled, 0) = 0'];
  const params = [];
  if (commentIds?.length) { where.push(`c.comment_id IN (${ph(commentIds)})`); params.push(...toStr(commentIds)); }
  if (unclassified) where.push('s.sentiment_at IS NULL');
  if (accountIds?.length) { where.push(`a.ig_id IN (${ph(accountIds)})`); params.push(...toStr(accountIds)); }
  return q.all(
    `SELECT c.comment_id, c.text, c.username, a.ig_id AS account_id, a.username AS account_username ${FROM_SQL}
     WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT ?`,
    ...params, Math.min(Math.max(1, limit), 2000),
  ).map((r) => ({ commentId: r.comment_id, text: r.text ?? '', username: r.username ?? '', accountId: r.account_id, accountUsername: r.account_username ?? '' }));
}

export function saveSentiments(results, { model = null, at = Date.now() } = {}) {
  q.tx(() => {
    for (const r of results) {
      if (!SENTIMENTS.includes(r.label)) continue;
      q.run(
        `INSERT INTO inbox_state (comment_id, status, sentiment, sentiment_score, sentiment_model, sentiment_at) VALUES (?, 'open', ?, ?, ?, ?)
         ON CONFLICT(comment_id) DO UPDATE SET sentiment = excluded.sentiment, sentiment_score = excluded.sentiment_score,
           sentiment_model = excluded.sentiment_model, sentiment_at = excluded.sentiment_at`,
        String(r.commentId), r.label, Number.isFinite(r.score) ? r.score : null, model, at,
      );
    }
  })();
}
