import { q } from '../index.js';
import { upsertComment } from './media.js';

/**
 * Comment queries for sync (storeComments, extracted unchanged from sync/jobs/platformAccount.js) and the v1.5 Studio
 * inbox (unanswered comments, reply suggestions in comment_replies, owner replies sent from the app).
 * "Answered" means the same as commentStats: an owner reply (is_from_owner = 1) whose parent_id is the comment.
 */

const DAY = 86_400_000;
export const INBOX_WINDOW_DAYS = 14;
const INBOX_LIMIT_MAX = 200;

/** Stores the IG comment shape {id, text, timestamp, like_count, username, replies:{data:[…]}} (sync + inbox refresh). */
export function storeComments(mediaId, comments, ownerUsername) {
  for (const c of comments) {
    const createdAt = new Date(c.timestamp).getTime();
    upsertComment({ commentId: c.id, mediaId, username: c.username, text: c.text, likeCount: c.like_count, createdAt, isFromOwner: c.username === ownerUsername, parentId: null });
    for (const r of c.replies?.data ?? []) {
      const rAt = new Date(r.timestamp).getTime();
      const fromOwner = r.username === ownerUsername;
      upsertComment({ commentId: r.id, mediaId, username: r.username, text: r.text ?? '', likeCount: 0, createdAt: rAt, isFromOwner: fromOwner, parentId: c.id, replyLatencyMinutes: fromOwner ? Math.round((rAt - createdAt) / 60_000) : null });
    }
  }
}

const OWNER_REPLY_EXISTS = 'EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.comment_id AND r.is_from_owner = 1)';
const CLOSED_REPLY_EXISTS = "EXISTS (SELECT 1 FROM comment_replies cr WHERE cr.comment_id = c.comment_id AND cr.status IN ('sent', 'dismissed'))";

function mapInbox(r) {
  return {
    commentId: r.comment_id,
    mediaId: r.media_id,
    accountId: r.ig_id,
    platform: r.platform ?? 'instagram',
    accountUsername: r.account_username,
    username: r.username ?? '',
    text: r.text ?? '',
    createdAt: r.created_at,
    likeCount: r.like_count ?? 0,
    caption: r.caption ?? null,
    permalink: r.permalink ?? null,
    thumb: r.thumbnail_path ?? null,
    mediaType: r.media_type ?? null,
    mediaProductType: r.media_product_type ?? null,
    answered: r.answered === 1,
    aiDisabled: r.ai_disabled === 1,
    reply: r.reply_status ? { status: r.reply_status, suggestion: r.reply_suggestion ?? null } : null,
  };
}

/**
 * Top-level comments from other people on tracked accounts' posts, newest first.
 * onlyUnanswered (default) hides comments with an owner reply or a sent/dismissed reply record.
 */
export function inboxComments({ accountIds, onlyUnanswered = true, limit = 50, before, now = Date.now(), days = INBOX_WINDOW_DAYS } = {}) {
  const where = ['c.is_from_owner = 0', 'c.parent_id IS NULL', 'm.is_deleted = 0', 'a.is_tracked = 1', 'c.created_at >= ?'];
  const params = [now - days * DAY];
  if (accountIds?.length) { where.push(`m.ig_id IN (${accountIds.map(() => '?').join(',')})`); params.push(...accountIds.map(String)); }
  if (Number.isFinite(before)) { where.push('c.created_at < ?'); params.push(before); }
  if (onlyUnanswered) where.push(`NOT ${OWNER_REPLY_EXISTS}`, `NOT ${CLOSED_REPLY_EXISTS}`);
  const lim = Math.min(Math.max(1, Math.trunc(Number(limit) || 50)), INBOX_LIMIT_MAX);
  const rows = q.all(
    `SELECT c.*, m.ig_id, m.caption, m.permalink, m.thumbnail_path, m.media_type, m.media_product_type,
       a.platform, a.username AS account_username, COALESCE(bv.ai_disabled, 0) AS ai_disabled,
       CASE WHEN ${OWNER_REPLY_EXISTS} THEN 1 ELSE 0 END AS answered,
       (SELECT cr.status FROM comment_replies cr WHERE cr.comment_id = c.comment_id ORDER BY cr.id DESC LIMIT 1) AS reply_status,
       (SELECT cr.suggestion FROM comment_replies cr WHERE cr.comment_id = c.comment_id ORDER BY cr.id DESC LIMIT 1) AS reply_suggestion
     FROM comments c
     JOIN media m ON m.media_id = c.media_id
     JOIN accounts a ON a.ig_id = m.ig_id
     LEFT JOIN brand_voice bv ON bv.account_id = m.ig_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.created_at DESC LIMIT ${lim}`,
    ...params,
  );
  return rows.map(mapInbox);
}

/** One comment with its post and account (for suggest/send), or null. */
export function getCommentContext(commentId) {
  const r = q.get(
    `SELECT c.*, m.ig_id, m.caption, m.permalink, m.thumbnail_path, m.media_type, m.media_product_type, m.external_id,
       a.platform, a.username AS account_username, a.external_id AS account_external_id, COALESCE(bv.ai_disabled, 0) AS ai_disabled,
       CASE WHEN ${OWNER_REPLY_EXISTS} THEN 1 ELSE 0 END AS answered
     FROM comments c
     JOIN media m ON m.media_id = c.media_id
     JOIN accounts a ON a.ig_id = m.ig_id
     LEFT JOIN brand_voice bv ON bv.account_id = m.ig_id
     WHERE c.comment_id = ?`,
    String(commentId),
  );
  if (!r) return null;
  return { ...mapInbox(r), parentId: r.parent_id ?? null, isFromOwner: r.is_from_owner === 1, accountExternalId: r.account_external_id ?? null };
}

/** Records the owner reply sent from the app, so response-rate / latency metrics update before the next sync. */
export function insertOwnerReply({ commentId, replyId, mediaId, text, username, parentCreatedAt, at = Date.now() }) {
  upsertComment({
    commentId: replyId, mediaId, username, text, likeCount: 0, createdAt: at, isFromOwner: true, parentId: commentId,
    replyLatencyMinutes: Number.isFinite(parentCreatedAt) ? Math.max(0, Math.round((at - parentCreatedAt) / 60_000)) : null,
  });
}

// ---------------------------------------------------------------- comment_replies

/** Replaces the open suggestions of a comment with a fresh set (status 'suggested'). */
export function saveReplySuggestions(commentId, suggestions, { generationId = null, now = Date.now() } = {}) {
  q.tx(() => {
    q.run("DELETE FROM comment_replies WHERE comment_id = ? AND status IN ('suggested', 'edited')", String(commentId));
    for (const s of suggestions) {
      q.run('INSERT INTO comment_replies (comment_id, suggestion, status, generation_id, created_at) VALUES (?, ?, ?, ?, ?)', String(commentId), s, 'suggested', generationId, now);
    }
  })();
}

export function listReplyRecords(commentId) {
  return q.all('SELECT * FROM comment_replies WHERE comment_id = ? ORDER BY id', String(commentId)).map((r) => ({
    id: r.id, commentId: r.comment_id, suggestion: r.suggestion, status: r.status, sentText: r.sent_text, sentReplyId: r.sent_reply_id,
    sentAt: r.sent_at, error: r.error, generationId: r.generation_id, createdAt: r.created_at,
  }));
}

/**
 * Records the outcome of a send (status 'sent' | 'failed'). A suggestion with the exact text becomes the record
 * (sent → 'sent'); otherwise a new row is added (suggestion = the edited text).
 */
export function recordReplyOutcome(commentId, { status, text, replyId = null, error = null, now = Date.now() }) {
  const id = String(commentId);
  const match = q.get("SELECT id, suggestion FROM comment_replies WHERE comment_id = ? AND status IN ('suggested', 'edited', 'failed') ORDER BY (suggestion = ?) DESC, id DESC LIMIT 1", id, text);
  const sentAt = status === 'sent' ? now : null;
  if (match && match.suggestion === text) {
    q.run('UPDATE comment_replies SET status = ?, sent_text = ?, sent_reply_id = ?, sent_at = ?, error = ? WHERE id = ?', status, text, replyId, sentAt, error, match.id);
    return match.id;
  }
  const res = q.run(
    'INSERT INTO comment_replies (comment_id, suggestion, status, sent_text, sent_reply_id, sent_at, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, text, status === 'sent' ? 'sent' : 'failed', text, replyId, sentAt, error, now,
  );
  return Number(res.lastInsertRowid);
}

/** "Mark done" without replying: the comment leaves the unanswered inbox. */
export function dismissComment(commentId, { now = Date.now() } = {}) {
  q.run("INSERT INTO comment_replies (comment_id, suggestion, status, created_at) VALUES (?, '', 'dismissed', ?)", String(commentId), now);
}

/** Recent media of an account for the on-demand inbox refresh (newest first). */
export function recentMediaForComments(igId, { now = Date.now(), days = INBOX_WINDOW_DAYS, limit = 25 } = {}) {
  return q.all(
    `SELECT media_id, external_id, posted_at FROM media
     WHERE ig_id = ? AND is_deleted = 0 AND posted_at >= ? AND COALESCE(media_product_type, '') <> 'STORY'
     ORDER BY posted_at DESC LIMIT ?`,
    String(igId), now - days * DAY, limit,
  );
}
