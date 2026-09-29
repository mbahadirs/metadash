import { isSupportedLang } from '../../locales/catalog.js';
import { getConfig } from '../../config/store.js';
import { msg } from '../../i18n.js';
import { AiError } from '../errors.js';
import { runGeneration, assertAccountsAllowed } from './runtime.js';
import { replySystemPrompt, replyUserText, anonymizeComment, deanonymize, REPLY_SCHEMA, REPLY_CATEGORIES } from './prompts/replies.js';
import { getBrandVoice } from '../../db/queries/studio.js';
import { listAccounts } from '../../db/queries/accounts.js';
import {
  inboxComments, getCommentContext, storeComments, insertOwnerReply, saveReplySuggestions, recordReplyOutcome, dismissComment, recentMediaForComments,
} from '../../db/queries/comments.js';
import { replyToComment, REPLY_SCOPES, REPLY_MAX_CHARS } from '../../meta/comments.js';
import { MetaError } from '../../meta/errors.js';
import { progressBus } from '../../sync/progress.js';

/**
 * Studio inbox (v1.5 chunk D): unanswered comments, AI reply suggestions in the brand voice, and sending a reply the
 * user confirmed. Replies are NEVER sent automatically: send() requires `confirmed: true`, which only the renderer's
 * confirmation dialog sets, and every send is one comment + one explicit text.
 * Only Instagram comments are synced, so only Instagram replies are sent (capabilities.comments is false elsewhere).
 */
const ID_RE = /^[A-Za-z0-9_:.-]{1,80}$/;
const REFRESH_ACCOUNTS_MAX = 50;

export function inboxError(key, vars) {
  return Object.assign(new Error(msg(key, vars)), { key, code: key.toUpperCase() });
}

function safeConfig(key, fallback) {
  try { return getConfig(key) ?? fallback; } catch { return fallback; }
}

const assertId = (v, field) => {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new AiError('ai_bad_input', { vars: { field } });
  return v;
};
const idList = (ids, field) => {
  if (ids == null) return undefined;
  if (!Array.isArray(ids) || ids.length > REFRESH_ACCOUNTS_MAX) throw new AiError('ai_bad_input', { vars: { field } });
  return ids.map((id) => assertId(String(id), field));
};
const changed = (payload) => { try { progressBus.emit('studio:changed', { kind: 'inbox', ...payload }); } catch { /* no listeners */ } };

// ---------------------------------------------------------------- inbox

export function listInbox({ accountIds, onlyUnanswered, limit, before } = {}, { now = Date.now() } = {}) {
  return inboxComments({
    accountIds: idList(accountIds, 'accountIds'),
    onlyUnanswered: onlyUnanswered !== false,
    limit: Number.isFinite(limit) ? limit : 50,
    before: Number.isFinite(before) ? before : undefined,
    now,
  });
}

/**
 * Fetches fresh comments for the accounts' posts from the last 14 days (Instagram provider's fetchComments, Meta
 * limiter + graph delay) and stores them with the same storeComments as sync. Demo mode: nothing is fetched.
 * deps: { provider, ctx, isDemo, now } for tests.
 */
export async function refreshInbox({ accountIds } = {}, deps = {}) {
  const ids = idList(accountIds, 'accountIds');
  if (deps.isDemo ?? (await isDemo())) return { fetched: 0, errors: 0, demo: true };
  const provider = deps.provider ?? (await import('../../providers/instagram/index.js')).default;
  const ctx = deps.ctx ?? (await import('../../publishing/context.js')).createPublishContext();
  const accounts = listAccounts({ platforms: ['instagram'] }).filter((a) => !ids?.length || ids.includes(a.igId));
  let fetched = 0;
  let errors = 0;
  for (const account of accounts) {
    const media = recentMediaForComments(account.igId, { now: deps.now ?? Date.now() });
    for (const m of media) {
      try {
        const comments = await provider.fetchComments(ctx, { mediaId: m.media_id, externalId: m.external_id ?? m.media_id }, { account });
        storeComments(m.media_id, comments, account.username);
        fetched += comments.length;
      } catch (e) {
        errors += 1;
        if (e instanceof MetaError && (e.isTokenError || e.isPermissionError)) break; // same result for every post of this account
        if (!(e instanceof MetaError)) throw e;
      }
      await (deps.delay ?? ctx.meta?.delay ?? (() => Promise.resolve()))();
    }
  }
  changed({ accountIds: accounts.map((a) => a.igId) });
  return { fetched, errors };
}

// ---------------------------------------------------------------- suggestions

function loadComment(commentId) {
  const c = getCommentContext(assertId(commentId, 'commentId'));
  if (!c) throw inboxError('inbox_comment_not_found');
  return c;
}

function readBrief(accountId) {
  try { return getBrandVoice(accountId)?.brief?.trim() || ''; } catch { return ''; }
}

/** Prompt parts shared by suggest() and the "what will be sent" preview. Nothing here leaves the machine by itself. */
export function buildReplyRequest(comment, { lang, anonymize = safeConfig('studio.anonymizeCommenters', true) !== false } = {}) {
  const brief = readBrief(comment.accountId);
  const anon = anonymizeComment({ username: comment.username, text: comment.text, ownerUsername: comment.accountUsername, enabled: anonymize });
  const system = replySystemPrompt(isSupportedLang(lang) ? lang : safeConfig('lang', 'en'));
  const userText = replyUserText({ comment: anon.text, handle: anon.handle, caption: comment.caption, brief });
  return { system, userText, map: anon.map, brief, anon };
}

const cleanSuggestion = (s, map) => deanonymize(s, map).replace(/[ \t]{2,}/g, ' ').replace(/^\s*[,.;:]\s*/, '').trim().slice(0, REPLY_MAX_CHARS);

/** 3 short replies + a category, in the brand voice. deps: { provider, caps } for tests. */
export async function suggestReplies({ commentId, lang, requestId } = {}, deps = {}) {
  const comment = loadComment(commentId);
  const req = buildReplyRequest(comment, { lang });
  const out = await runGeneration(
    {
      feature: 'reply', requestId, accountId: comment.accountId,
      sentSummary: { comments: 1, commentChars: comment.text.length, captionChars: Math.min((comment.caption ?? '').length, 600), brief: !!req.brief, anonymized: req.anon.handle.startsWith('@user') },
      output: (res) => ({ category: res.data?.category, suggestions: res.data?.suggestions }),
    },
    ({ structured }) => structured({ system: req.system, userText: req.userText, schema: REPLY_SCHEMA, name: 'emit_result', maxTokens: 800 }),
    deps,
  );
  const category = REPLY_CATEGORIES.includes(out.data?.category) ? out.data.category : 'other';
  const suggestions = [...new Set((out.data?.suggestions ?? []).map((s) => cleanSuggestion(s, req.map)).filter(Boolean))].slice(0, 3);
  saveReplySuggestions(comment.commentId, suggestions, { generationId: out.generationId ?? null });
  changed({ accountIds: [comment.accountId], ids: [comment.commentId] });
  return {
    category, suggestions, language: out.data?.language ?? null,
    usage: out.usage, costUsd: out.costUsd, generationId: out.generationId, provider: out.provider, model: out.model,
  };
}

/** studio:preview 'reply': what will be sent for one comment (the same builder as suggestReplies). */
export function replyPreview(params = {}) {
  const comment = loadComment(params.commentId);
  assertAccountsAllowed([comment.accountId]);
  const req = buildReplyRequest(comment, { lang: params.lang });
  const items = [
    { kind: 'text', label: 'comment', chars: req.anon.text.length, ids: [comment.commentId] },
    { kind: 'text', label: 'caption', chars: Math.min((comment.caption ?? '').length, 600) },
  ];
  if (req.brief) items.push({ kind: 'text', label: 'brief', chars: req.brief.length });
  return { items, text: `${req.system}\n${req.userText}`, expectedOutputTokens: 300 };
}

// ---------------------------------------------------------------- send / dismiss

async function isDemo() {
  try { return (await import('../../publishing/context.js')).isDemoMode(); } catch { return false; }
}

async function hasReplyScope(platform) {
  const { getReadiness } = await import('../../publishing/readiness.js');
  const r = await getReadiness();
  // readiness.firstComment is exactly "REPLY_SCOPES[platform] granted" (FIRST_COMMENT_SCOPES in meta/auth.js).
  return platform === 'facebook' ? r.facebook?.firstComment === true : r.instagram?.firstComment === true;
}

/**
 * Sends one reply the user confirmed. { commentId, text, confirmed: true } → { replyId, demo? }.
 * deps: { isDemo, hasScope(platform), token, client, now } for tests.
 */
export async function sendReply({ commentId, text, confirmed } = {}, deps = {}) {
  if (confirmed !== true) throw inboxError('inbox_confirm_required');
  const comment = loadComment(commentId);
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) throw inboxError('inbox_reply_empty');
  if (body.length > REPLY_MAX_CHARS) throw inboxError('inbox_reply_too_long', { max: REPLY_MAX_CHARS });
  if (comment.isFromOwner || comment.parentId) throw inboxError('inbox_not_replyable');
  if (comment.platform !== 'instagram') throw inboxError('inbox_platform_unsupported');
  const now = deps.now ?? Date.now();

  let replyId;
  const demo = deps.isDemo ?? (await isDemo());
  if (demo) {
    replyId = `demo-reply-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  } else {
    const scopeOk = deps.hasScope ? await deps.hasScope(comment.platform) : await hasReplyScope(comment.platform);
    if (!scopeOk) throw inboxError('inbox_missing_scope', { scope: REPLY_SCOPES[comment.platform] });
    try {
      const token = deps.token ?? (await import('../../publishing/context.js')).readAuthToken('meta');
      if (!token) throw inboxError('inbox_not_connected');
      const res = await replyToComment({ platform: comment.platform, commentId: comment.commentId, text: body, token, client: deps.client });
      if (!res.id) throw inboxError('inbox_send_failed', { detail: 'no id' });
      replyId = res.id;
    } catch (e) {
      recordReplyOutcome(comment.commentId, { status: 'failed', text: body, error: String(e?.message ?? e).slice(0, 300), now });
      if (e instanceof MetaError && e.isPermissionError) throw inboxError('inbox_missing_scope', { scope: REPLY_SCOPES[comment.platform] });
      throw e;
    }
  }
  insertOwnerReply({ commentId: comment.commentId, replyId, mediaId: comment.mediaId, text: body, username: comment.accountUsername, parentCreatedAt: comment.createdAt, at: now });
  recordReplyOutcome(comment.commentId, { status: 'sent', text: body, replyId, now });
  changed({ accountIds: [comment.accountId], ids: [comment.commentId] });
  return { replyId, demo: demo || undefined };
}

export function dismissInboxComment({ commentId } = {}) {
  const comment = loadComment(commentId);
  dismissComment(comment.commentId);
  changed({ accountIds: [comment.accountId], ids: [comment.commentId] });
  return null;
}
