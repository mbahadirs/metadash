/**
 * Unified inbox queries — STUB (v2.0 chunk B). Chunk D owns this file and implements every export on top of
 * migration 012 (comments + inbox_state + inbox_cursor, and comment_replies as the reply outbox). The v1.5 Studio
 * inbox queries in db/queries/comments.js stay and are reused/wrapped, not duplicated.
 *
 *   upsertNormalized(comments: NormalizedComment[], { fetchedAt }) → { inserted, updated }
 *   listInbox(filters, cursor) → { items: InboxItem[], nextCursor: string|null, counts: {open, replied, done, overdue} }
 *     filters: { status, platforms, accountIds, sentiment, assignee, question, q, from, to, sort, limit }; keyset on (created_at, comment_id)
 *   thread(commentId) → { root: InboxItem, replies: InboxItem[], post: {...}, outbox: OutboxRow[] }
 *   setStatus(commentIds, status, { by, at }) → number
 *   assign(commentIds, assignee, { by, at }) → number
 *   slaRows({ from, to, accountIds, platforms }) → [{ commentId, accountId, platform, createdAt, firstResponseAt }]
 *   commentStatsV2(igId, fromMs, toMs) → { total, incoming, answered, withinSla, avgLatency, medianFrtMin }
 *   getCursor(accountId, mediaId) / setCursor(accountId, mediaId, { lastPolledAt, lastCommentCount })
 *   outbox: beginSend({ commentId, accountId, platform, body, author }) → id; markSent(id, { remoteId, at }); markFailed(id, { code, message })
 */
const stub = (name) => () => { throw Object.assign(new Error(`db/queries/inbox.${name} is not implemented yet`), { code: 'NOT_IMPLEMENTED' }); };

export const upsertNormalized = stub('upsertNormalized');
export const listInbox = stub('listInbox');
export const thread = stub('thread');
export const setStatus = stub('setStatus');
export const assign = stub('assign');
export const slaRows = stub('slaRows');
export const commentStatsV2 = stub('commentStatsV2');
export const getCursor = stub('getCursor');
export const setCursor = stub('setCursor');
export const beginSend = stub('beginSend');
export const markSent = stub('markSent');
export const markFailed = stub('markFailed');

/** Tables chunk D adds to the demo reset (seed/index.js clearAll). */
export const INBOX_TABLES = Object.freeze(['inbox_state', 'inbox_cursor']);
