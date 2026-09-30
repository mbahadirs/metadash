import { MetaError } from '../meta/errors.js';
import { getSetting, setSetting } from '../db/queries/settings.js';
import { upsertNormalized, pollCandidates, setCursor } from '../db/queries/inbox.js';
import { adapterFor } from './registry.js';
import { inboxSettings } from './settings.js';
import { isQuestion } from './question.js';
import { emitInboxUpdated } from './events.js';

/**
 * Comment polling through the inbox adapters (inbox/registry.js: provider.inbox ?? built-in IG/FB/Threads).
 *
 *   syncAccountComments(ctx, provider, account, { candidates, now, log, delay, signal })
 *     comments step of a full/organic sync (sync/jobs/platformAccount.js, when settings.syncComments is on).
 *   pollAccountInbox(ctx, provider, account, { log, now })
 *     sync scope 'inbox' (sync/orchestrator.js, one job per account whose capabilities.inbox is true).
 *   periodic  { id: 'inbox.poll', intervalMs: inbox.pollMinutes, run } → runSync({ scope: 'inbox' }) while the app runs.
 *
 * Which posts: every post of the last inbox.lookbackDays, plus older posts (≤ 90 days) whose synced comment count grew
 * since the last poll (inbox_cursor). The sync's own candidate list is merged in. Permission / invalid-parameter
 * errors are logged and stop this account (the same answer would come for every post); token errors propagate so the
 * orchestrator can pause the auth.
 */
/** After a permission refusal an account is not polled in the background for this long (manual refresh still tries). */
export const DENIED_BACKOFF_MS = 24 * 3_600_000;
const deniedKey = (accountId) => `inbox.denied.${accountId}`;
export function deniedRecently(accountId, now = Date.now()) {
  try { const at = Number(getSetting(deniedKey(accountId), 0)); return Number.isFinite(at) && at > 0 && now - at < DENIED_BACKOFF_MS; } catch { return false; }
}
function markDenied(accountId, at) {
  try { setSetting(deniedKey(accountId), at); } catch { /* db closed */ }
}

const isSoftError = (e) => (e instanceof MetaError && (e.isPermissionError || e.isInvalidParam)) || e?.code === 'page_token_missing';
const noDelay = async () => {};

function mergeCandidates(accountId, candidates, { now, lookbackDays }) {
  const byId = new Map();
  for (const m of pollCandidates(accountId, { now, lookbackDays })) byId.set(m.media_id, m);
  const DAY = 86_400_000;
  for (const m of candidates ?? []) if (!byId.has(m.media_id) && now - m.posted_at < lookbackDays * DAY) byId.set(m.media_id, m);
  return [...byId.values()];
}

/**
 * Polls the given posts of one account through its adapter and stores the comments.
 * → { fetched, posts, errors, stopped }
 */
export async function pollPosts(ctx, adapter, account, posts, { now = Date.now(), log = () => {}, delay = noDelay, signal } = {}) {
  let fetched = 0;
  let done = 0;
  let errors = 0;
  for (const m of posts) {
    if (signal?.aborted) break;
    try {
      const comments = await adapter.fetch(ctx, account, { mediaId: m.media_id, externalId: m.external_id ?? m.media_id }, { now });
      const withRule = comments.map((c) => (!c.parentId && !c.isFromOwner ? { ...c, isQuestion: isQuestion(c.text) } : c));
      upsertNormalized(withRule, { fetchedAt: now });
      const top = comments.filter((c) => !c.parentId).length;
      setCursor(account.igId, m.media_id, { lastPolledAt: now, lastCommentCount: Math.max(Number(m.comment_count) || 0, top) });
      fetched += comments.length;
      done += 1;
    } catch (e) {
      if (!isSoftError(e)) throw e;
      errors += 1;
      log({ endpoint: 'comments', code: e.code, message: e.message });
      if (e instanceof MetaError && e.isPermissionError) markDenied(account.igId, now);
      return { fetched, posts: done, errors, stopped: true };
    }
    await delay();
  }
  if (done && deniedRecently(account.igId, now)) markDenied(account.igId, 0); // permission granted again
  return { fetched, posts: done, errors, stopped: false };
}

async function maybeClassify(accountId) {
  const s = inboxSettings();
  if (!s.aiSentiment) return;
  try {
    const { classifyComments } = await import('./sentiment.js');
    await classifyComments({ unclassified: true, accountIds: [accountId] });
  } catch (e) {
    console.warn('[inbox] sentiment skipped:', e?.message ?? e);
  }
}

export async function syncAccountComments(ctx, provider, account, { candidates = [], now = Date.now(), log = () => {}, delay = noDelay, signal } = {}) {
  const adapter = adapterFor(provider.platform ?? account.platform ?? 'instagram');
  if (!adapter) return { fetched: 0 };
  if (deniedRecently(account.igId, now)) return { fetched: 0, skipped: 'denied' };
  const { lookbackDays } = inboxSettings();
  const posts = mergeCandidates(account.igId, candidates, { now, lookbackDays });
  const res = await pollPosts(ctx, adapter, account, posts, { now, log, delay, signal });
  if (res.fetched) {
    emitInboxUpdated({ accountIds: [account.igId], reason: 'poll' });
    await maybeClassify(account.igId);
  }
  return res;
}

export async function pollAccountInbox(ctx, provider, account, { log = () => {}, now = Date.now() } = {}) {
  if (provider.prepare) await provider.prepare(ctx, account); // Facebook: Page token into ctx.pageTokens
  const delay = () => provider.client?.delay?.() ?? Promise.resolve();
  return syncAccountComments(ctx, provider, account, { candidates: [], now, log, delay, signal: ctx.signal });
}

/** Expected "try later" outcomes of the periodic run (another sync, no connection yet). */
const SKIP = new Set(['SYNC_RUNNING', 'SYNC_LOCKED', 'NO_PROFILE']);

export async function runPeriodicPoll({ run } = {}) {
  if (!inboxSettings().poll) return { skipped: 'disabled' };
  const runSync = run ?? (await import('../sync/orchestrator.js')).runSync;
  try {
    return await runSync({ scope: 'inbox' });
  } catch (e) {
    if (SKIP.has(e?.message)) return { skipped: e.message };
    throw e;
  }
}

export const periodic = {
  id: 'inbox.poll',
  get intervalMs() { return inboxSettings().pollMinutes * 60_000; },
  runOnStart: false,
  run: () => runPeriodicPoll(),
};
