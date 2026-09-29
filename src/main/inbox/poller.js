import { MetaError } from '../meta/errors.js';
import { storeComments, recentMediaForComments, INBOX_WINDOW_DAYS } from '../db/queries/comments.js';

/**
 * Comment polling — STUB with the v1.5 behaviour (v2.0 chunk B). Chunk D owns src/main/inbox/** and replaces this
 * with the adapter-based poller (inbox/registry.js adapterFor(platform) → provider.inbox ?? built-in IG/FB/Threads
 * adapters, inbox_cursor heuristics, first-response bookkeeping). The exported names and signatures are the contract:
 *
 *   syncAccountComments(ctx, provider, account, { candidates, now, log, delay, signal })
 *     called by sync/jobs/platformAccount.js step 6 when settings.syncComments is on. `candidates` = media rows
 *     ({ media_id, external_id, posted_at }) of the account within the lookback window.
 *   pollAccountInbox(ctx, provider, account, { log, now })
 *     called by sync/orchestrator.js for scope 'inbox' (one job per account whose capabilities.inbox is true).
 *   periodic: null | { id, intervalMs, run }   registered by sync/periodic.js (see sync/scheduler.js registerPeriodic)
 *
 * Today: only providers with fetchComments (Instagram) are polled; comments are stored with storeComments.
 */
const DAY = 86_400_000;
const isSoftError = (e) => e instanceof MetaError && (e.isPermissionError || e.isInvalidParam);

export async function syncAccountComments(ctx, provider, account, { candidates = [], now = Date.now(), log = () => {}, delay = async () => {}, signal } = {}) {
  if (!provider.fetchComments) return { fetched: 0 };
  const recent = candidates.filter((m) => now - m.posted_at < INBOX_WINDOW_DAYS * DAY);
  let fetched = 0;
  for (const m of recent) {
    if (signal?.aborted) return { fetched };
    try {
      const comments = await provider.fetchComments(ctx, { mediaId: m.media_id, externalId: m.external_id ?? m.media_id }, { account });
      storeComments(m.media_id, comments, account.username);
      fetched += comments.length;
    } catch (e) {
      if (isSoftError(e)) { log({ endpoint: 'comments', code: e.code, message: e.message }); break; }
      throw e;
    }
    await delay();
  }
  return { fetched };
}

export async function pollAccountInbox(ctx, provider, account, { log = () => {}, now = Date.now() } = {}) {
  const candidates = recentMediaForComments(account.igId, { now });
  const delay = () => provider.client?.delay?.() ?? Promise.resolve();
  return syncAccountComments(ctx, provider, account, { candidates, now, log, delay, signal: ctx.signal });
}

export const periodic = null;
