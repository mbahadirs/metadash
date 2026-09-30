import { listInbox, thread, setStatus, assign, inboxCounts, STATUSES, SENTIMENTS } from '../db/queries/inbox.js';
import { KNOWN_PLATFORMS } from '../providers/index.js';
import { inboxSettings } from '../inbox/settings.js';
import { sendInboxReply, retryInboxReply, hideInboxComment, inboxError } from '../inbox/reply.js';
import { refreshInbox } from '../inbox/refresh.js';
import { inboxSla } from '../inbox/sla.js';
import { classifyComments, classifyPreview } from '../inbox/sentiment.js';
import { inboxCapabilities, selfAuthor } from '../inbox/capabilities.js';
import { emitInboxUpdated } from '../inbox/events.js';

/**
 * Unified inbox channels (v2.0 chunk D). Payloads are validated here (the renderer is not trusted); results follow
 * lib/types.ts Inbox*. Replies are sent only with `confirmed: true` (set by the renderer's confirmation dialog).
 */
export const INBOX_CHANNELS = Object.freeze([
  'inbox:list',
  'inbox:thread',
  'inbox:reply',
  'inbox:retry',
  'inbox:setStatus',
  'inbox:assign',
  'inbox:hide',
  'inbox:refresh',
  'inbox:suggest',
  'inbox:classify',
  'inbox:classifyPreview',
  'inbox:sla',
  'inbox:capabilities',
  'inbox:counts',
]);

const ID_RE = /^[A-Za-z0-9_:.-]{1,120}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IDS_MAX = 500;
const LIST_STATUSES = [...STATUSES, 'unanswered', 'overdue', 'all'];
const SORTS = ['newest', 'oldest', 'overdue'];

const bad = (field) => inboxError('inbox_bad_input', { field });
const obj = (p) => (p && typeof p === 'object' && !Array.isArray(p) ? p : {});

function id(v, field) {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw bad(field);
  return v;
}
function ids(v, field, { required = false } = {}) {
  if (v == null && !required) return undefined;
  if (!Array.isArray(v) || v.length > IDS_MAX || (required && !v.length)) throw bad(field);
  return v.map((x) => id(String(x), field));
}
function oneOf(v, list, field) {
  if (v == null) return undefined;
  if (!list.includes(v)) throw bad(field);
  return v;
}
function listOf(v, list, field) {
  if (v == null) return undefined;
  if (!Array.isArray(v) || v.some((x) => !list.includes(x))) throw bad(field);
  return v;
}
function date(v, field) {
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string' || !DATE_RE.test(v)) throw bad(field);
  return v;
}
function shortText(v, field, max = 100) {
  if (v == null) return undefined;
  if (typeof v !== 'string' || v.length > max) throw bad(field);
  return v;
}

/** Validated InboxListParams. */
export function parseListParams(p) {
  const x = obj(p);
  const assignee = x.assignee === null ? null : shortText(x.assignee, 'assignee', 80);
  return {
    status: oneOf(x.status, LIST_STATUSES, 'status') ?? 'open',
    platforms: listOf(x.platforms, KNOWN_PLATFORMS, 'platforms'),
    accountIds: ids(x.accountIds, 'accountIds'),
    sentiment: listOf(x.sentiment, SENTIMENTS, 'sentiment'),
    assignee,
    question: x.question === true ? true : undefined,
    q: shortText(x.q, 'q'),
    from: date(x.from, 'from'),
    to: date(x.to, 'to'),
    sort: oneOf(x.sort, SORTS, 'sort'),
    cursor: x.cursor == null ? undefined : shortText(x.cursor, 'cursor', 400),
    limit: Number.isFinite(x.limit) ? x.limit : undefined,
  };
}

const slaHours = () => inboxSettings().slaHours;

/** Team sync (F1): status / assignment changes travel as per-comment events; never fails the local change. */
async function teamEvents(op, commentIds, field, value) {
  try {
    const { recordTeamEvent } = await import('../team/index.js');
    for (const commentId of commentIds) recordTeamEvent(op, { commentId, [field]: value });
  } catch (e) {
    console.error('[inbox] team event', e?.message ?? e);
  }
}

export function registerInboxHandlers(handle) {
  handle('inbox:list', (p) => listInbox(parseListParams(p), undefined, { slaHours: slaHours() }));

  handle('inbox:thread', (p) => {
    const t = thread(id(obj(p).commentId, 'commentId'), { slaHours: slaHours() });
    if (!t) throw inboxError('inbox_comment_not_found');
    return t;
  });

  handle('inbox:reply', (p) => {
    const x = obj(p);
    if (typeof x.body !== 'string' || x.body.length > 20_000) throw bad('body');
    return sendInboxReply({ commentId: id(x.commentId, 'commentId'), body: x.body, confirmed: x.confirmed === true }, { author: selfAuthor() });
  });

  handle('inbox:retry', (p) => {
    const outboxId = Number(obj(p).outboxId);
    if (!Number.isInteger(outboxId) || outboxId <= 0) throw bad('outboxId');
    return retryInboxReply({ outboxId }, { author: selfAuthor() });
  });

  handle('inbox:setStatus', async (p) => {
    const x = obj(p);
    const list = ids(x.commentIds, 'commentIds', { required: true });
    const status = oneOf(x.status, STATUSES, 'status');
    if (!status) throw bad('status');
    const updated = setStatus(list, status, { by: selfAuthor() });
    await teamEvents('inbox.status', list, 'status', status);
    emitInboxUpdated({ commentIds: list, reason: 'status' });
    return { updated };
  });

  handle('inbox:assign', async (p) => {
    const x = obj(p);
    const list = ids(x.commentIds, 'commentIds', { required: true });
    const who = x.assignee == null || x.assignee === '' ? null : shortText(String(x.assignee).trim(), 'assignee', 80);
    const updated = assign(list, who || null, { by: selfAuthor() });
    await teamEvents('inbox.assign', list, 'assignee', who || null);
    emitInboxUpdated({ commentIds: list, reason: 'assign' });
    return { updated };
  });

  handle('inbox:hide', (p) => {
    const x = obj(p);
    return hideInboxComment({ commentId: id(x.commentId, 'commentId'), hidden: x.hidden === true });
  });

  handle('inbox:refresh', (p) => refreshInbox({ accountIds: ids(obj(p).accountIds, 'accountIds') }));

  handle('inbox:suggest', async (p) => {
    const x = obj(p);
    const { suggestReplies } = await import('../ai/studio/replies.js');
    return suggestReplies({ commentId: id(x.commentId, 'commentId'), requestId: shortText(x.requestId, 'requestId'), lang: shortText(x.lang, 'lang', 10) });
  });

  handle('inbox:classify', async (p) => {
    const x = obj(p);
    const commentIds = ids(x.commentIds, 'commentIds');
    const res = await classifyComments({ commentIds, unclassified: x.unclassified === true ? true : undefined, requestId: shortText(x.requestId, 'requestId') });
    emitInboxUpdated({ commentIds, reason: 'classify' });
    return res;
  });

  handle('inbox:classifyPreview', (p) => {
    const x = obj(p);
    return classifyPreview({ commentIds: ids(x.commentIds, 'commentIds'), unclassified: x.unclassified === true ? true : undefined });
  });

  handle('inbox:sla', (p) => {
    const x = obj(p);
    return inboxSla({ from: date(x.from, 'from'), to: date(x.to, 'to'), accountIds: ids(x.accountIds, 'accountIds'), platforms: listOf(x.platforms, KNOWN_PLATFORMS, 'platforms') });
  });

  handle('inbox:capabilities', () => inboxCapabilities());

  handle('inbox:counts', () => inboxCounts({}, { slaHours: slaHours() }));
}
