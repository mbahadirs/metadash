import { msg } from '../i18n.js';
import { MetaError } from '../meta/errors.js';
import { getAccount } from '../db/queries/accounts.js';
import { upsertComment } from '../db/queries/media.js';
import { getCommentContext } from '../db/queries/comments.js';
import {
  beginSend, restartSend, markSent, markFailed, getOutbox, outboxFor, ownerReplyWithText, refreshFirstResponse, setHidden,
} from '../db/queries/inbox.js';
import { adapterFor } from './registry.js';
import { commentKey } from './keys.js';
import { emitInboxUpdated } from './events.js';

/**
 * Replying from the app (outbox state machine on comment_replies):
 *   sending → (adapter.reply) → sent  : owner reply inserted into comments (is_from_owner = 1) so answered/SLA update now
 *                              → failed: error_code + message kept; inbox:retry re-sends the same body (failed → sending)
 * Never automatic: every send needs `confirmed: true`, set only by the renderer's confirmation dialog.
 * Crash recovery: a 'sending' row younger than 5 minutes blocks a second send; an older one is resolved first — if an
 * owner reply with the identical text exists under the comment since the attempt started it becomes 'sent', otherwise
 * 'failed' (so the user can retry deliberately; nothing is re-sent silently).
 */
export const STALE_SENDING_MS = 5 * 60_000;
const ID_RE = /^[A-Za-z0-9_:.-]{1,120}$/;

export function inboxError(key, vars) {
  return Object.assign(new Error(msg(key, vars)), { key, code: key.toUpperCase() });
}

const assertId = (v) => {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw inboxError('inbox_bad_input', { field: 'commentId' });
  return v;
};

async function isDemo() {
  try { return (await import('../publishing/context.js')).isDemoMode(); } catch { return false; }
}

async function defaultCtx() {
  const { createPublishContext } = await import('../publishing/context.js');
  return createPublishContext();
}

function loadReplyable(commentId) {
  const c = getCommentContext(assertId(commentId));
  if (!c) throw inboxError('inbox_comment_not_found');
  if (c.isFromOwner || c.parentId) throw inboxError('inbox_not_replyable');
  return c;
}

function adapterForReply(platform, deps) {
  const adapter = deps.adapter ?? adapterFor(platform);
  if (!adapter?.reply) throw inboxError('inbox_reply_unsupported', { platform });
  return adapter;
}

/** Resolves a stuck 'sending' row of this comment (see header). Throws when a send is still in flight. */
function resolveStale(comment, now) {
  for (const row of outboxFor(comment.commentId).filter((r) => r.status === 'sending')) {
    const started = row.sendingAt ?? row.createdAt;
    if (now - started < STALE_SENDING_MS) throw inboxError('inbox_send_in_progress');
    const found = ownerReplyWithText(comment.commentId, row.body, started - 60_000);
    if (found) markSent(row.id, { remoteId: found.comment_id, at: found.created_at });
    else markFailed(row.id, { code: 'interrupted', message: msg('inbox_send_interrupted') });
  }
}

function normalizedOf(c) {
  return {
    commentId: c.commentId, externalId: c.externalId ?? c.commentId, mediaId: c.mediaId, accountId: c.accountId, platform: c.platform,
    parentId: null, authorId: null, username: c.username, text: c.text, likeCount: c.likeCount ?? 0, createdAt: c.createdAt,
    isFromOwner: false, permalink: null, isHidden: false,
  };
}

function recordOwnerReply(comment, { remoteId, body, at }) {
  upsertComment({
    commentId: commentKey(comment.platform, remoteId), externalId: String(remoteId), mediaId: comment.mediaId, accountId: comment.accountId,
    platform: comment.platform, username: comment.accountUsername, text: body, likeCount: 0, createdAt: at, isFromOwner: true,
    parentId: comment.commentId, replyLatencyMinutes: Math.max(0, Math.round((at - comment.createdAt) / 60_000)), fetchedAt: at,
  });
  refreshFirstResponse([comment.commentId], { source: 'app' });
}

/** Runs one attempt of outbox row `id`. Returns the updated row; throws a localized error after marking it failed. */
async function attempt(id, comment, body, adapter, deps) {
  const now = deps.now ?? Date.now();
  let remoteId;
  if (deps.isDemo ?? (await isDemo())) {
    remoteId = `demo-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  } else {
    try {
      const account = getAccount(comment.accountId) ?? { igId: comment.accountId, platform: comment.platform, username: comment.accountUsername, externalId: comment.accountExternalId };
      const ctx = deps.ctx ?? (await defaultCtx());
      const res = await adapter.reply(ctx, account, normalizedOf(comment), body);
      if (!res?.remoteId) throw inboxError('inbox_send_failed', { detail: 'no id' });
      remoteId = String(res.remoteId);
    } catch (e) {
      const permission = e instanceof MetaError && e.isPermissionError;
      markFailed(id, { code: permission ? 'permission' : e?.code ?? e?.key ?? 'error', message: String(e?.message ?? e) });
      emitInboxUpdated({ commentIds: [comment.commentId], accountIds: [comment.accountId], reason: 'reply' });
      if (permission) throw inboxError('inbox_missing_scope', { scope: (adapter.scopes?.reply ?? []).join(', ') });
      throw e;
    }
  }
  const at = deps.now ?? Date.now();
  markSent(id, { remoteId, at });
  recordOwnerReply(comment, { remoteId, body, at });
  emitInboxUpdated({ commentIds: [comment.commentId], accountIds: [comment.accountId], reason: 'reply' });
  return getOutbox(id);
}

/**
 * inbox:reply { commentId, body, confirmed: true } → InboxOutboxRow.
 * deps: { adapter, ctx, isDemo, now, author } for tests.
 */
export async function sendInboxReply({ commentId, body, confirmed } = {}, deps = {}) {
  if (confirmed !== true) throw inboxError('inbox_confirm_required');
  const comment = loadReplyable(commentId);
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw inboxError('inbox_reply_empty');
  const adapter = adapterForReply(comment.platform, deps);
  const max = adapter.maxReplyLength ?? 2200;
  if (text.length > max) throw inboxError('inbox_reply_too_long', { max });
  const now = deps.now ?? Date.now();
  resolveStale(comment, now);
  const id = beginSend({ commentId: comment.commentId, accountId: comment.accountId, platform: comment.platform, body: text, author: deps.author ?? null, now });
  return attempt(id, comment, text, adapter, deps);
}

/** inbox:retry { outboxId } → InboxOutboxRow. Only failed rows are re-sent (same body). */
export async function retryInboxReply({ outboxId } = {}, deps = {}) {
  const row = getOutbox(outboxId);
  if (!row) throw inboxError('inbox_outbox_not_found');
  if (row.status !== 'failed') throw inboxError('inbox_retry_not_failed');
  const comment = loadReplyable(row.commentId);
  const adapter = adapterForReply(comment.platform, deps);
  if (!restartSend(row.id, { now: deps.now ?? Date.now() })) throw inboxError('inbox_retry_not_failed');
  return attempt(row.id, comment, row.body, adapter, deps);
}

/** inbox:hide { commentId, hidden } → true. deps as sendInboxReply. */
export async function hideInboxComment({ commentId, hidden } = {}, deps = {}) {
  const c = getCommentContext(assertId(commentId));
  if (!c) throw inboxError('inbox_comment_not_found');
  const adapter = deps.adapter ?? adapterFor(c.platform);
  if (!adapter?.hide) throw inboxError('inbox_hide_unsupported', { platform: c.platform });
  if (!(deps.isDemo ?? (await isDemo()))) {
    const account = getAccount(c.accountId) ?? { igId: c.accountId, platform: c.platform, externalId: c.accountExternalId };
    try {
      await adapter.hide(deps.ctx ?? (await defaultCtx()), account, normalizedOf(c), !!hidden);
    } catch (e) {
      if (e instanceof MetaError && e.isPermissionError) throw inboxError('inbox_missing_scope', { scope: (adapter.scopes?.hide ?? []).join(', ') });
      throw e;
    }
  }
  setHidden(c.commentId, !!hidden);
  emitInboxUpdated({ commentIds: [c.commentId], accountIds: [c.accountId], reason: 'hide' });
  return true;
}
