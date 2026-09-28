import PQueue from 'p-queue';
import { listAccounts } from '../db/queries/accounts.js';
import { listAdAccounts } from '../db/queries/ads.js';
import { allCompetitors } from '../db/queries/competitors.js';
import { createRun, updateRun, logError, lastSuccessfulRun } from '../db/queries/sync.js';
import { getActiveProfile } from '../db/queries/profiles.js';
import { readToken, getAllConfig } from '../config/store.js';
import { MetaError, NetworkError } from '../meta/errors.js';
import { rateLimiter } from '../meta/rateLimiter.js';
import { apiCallsSoFar, resetApiCalls } from '../meta/client.js';
import { emitProgress, emitDone, emitTokenWarning } from './progress.js';
import { syncOrganicAccount } from './jobs/organicAccount.js';
import { syncStoriesAccount } from './jobs/storiesAccount.js';
import { syncAdsAccount } from './jobs/adsAccount.js';
import { syncCompetitor } from './jobs/competitor.js';
import { runDemoSync } from './demo.js';
import { msg } from '../i18n.js';

export const queues = {
  organic: new PQueue({ concurrency: 2 }),
  stories: new PQueue({ concurrency: 2 }),
  ads: new PQueue({ concurrency: 2 }),
  competitors: new PQueue({ concurrency: 1 }),
};

const state = {
  running: false,
  runId: null,
  scope: null,
  phase: null,
  currentAccount: null,
  done: 0,
  total: 0,
  apiCalls: 0,
  startedAt: null,
  abort: null,
  errors: 0,
  tokenInvalid: false,
};

export function syncStatus() {
  const last = lastSuccessfulRun();
  return {
    running: state.running, runId: state.runId, scope: state.scope, phase: state.phase, currentAccount: state.currentAccount,
    done: state.done, total: state.total, apiCalls: state.apiCalls, startedAt: state.startedAt, errors: state.errors,
    lastSuccessAt: last?.finished_at ?? null, rateLimit: rateLimiter.snapshot(), tokenInvalid: state.tokenInvalid,
  };
}

export function cancelSync() {
  if (!state.running) return false;
  state.abort?.abort();
  for (const q of Object.values(queues)) q.clear();
  return true;
}

export function isDemoProfile(profile) {
  return !!profile && String(profile.token_ref).startsWith('demo');
}

/**
 * Runs a sync. scope: full | organic | ads | stories | competitors. igIds narrows organic/stories work.
 */
export async function runSync({ scope = 'full', igIds } = {}) {
  if (state.running) throw new Error('SYNC_RUNNING');
  const profile = getActiveProfile();
  if (!profile) throw new Error('NO_PROFILE');
  const settings = getAllConfig();
  const accounts = listAccounts().filter((a) => !igIds?.length || igIds.includes(a.igId));
  const adAccounts = scope === 'full' || scope === 'ads' ? listAdAccounts().filter((a) => a.isTracked && (!igIds?.length || !a.linkedIgId || igIds.includes(a.linkedIgId))) : [];
  const competitors = scope === 'full' || scope === 'competitors' ? allCompetitors().filter((c) => !igIds?.length || igIds.includes(c.linked_ig_id)) : [];
  const organicCount = scope === 'full' || scope === 'organic' ? accounts.length : 0;
  const storyCount = scope === 'full' || scope === 'stories' ? accounts.length : 0;
  const total = organicCount + storyCount + adAccounts.length + competitors.length;

  const runId = createRun(scope, total);
  Object.assign(state, { running: true, runId, scope, phase: 'accounts', currentAccount: null, done: 0, total, apiCalls: 0, startedAt: Date.now(), abort: new AbortController(), errors: 0, tokenInvalid: false });
  resetApiCalls();
  const progress = () => {
    state.apiCalls = apiCallsSoFar();
    emitProgress({ runId, phase: state.phase, currentAccount: state.currentAccount, done: state.done, total: state.total, apiCalls: state.apiCalls });
  };
  progress();

  if (isDemoProfile(profile)) {
    runDemo(runId, scope, accounts, adAccounts, competitors, progress).catch(() => {});
    return { runId, demo: true };
  }

  const token = readToken(profile.token_ref);
  if (!token) {
    finish(runId, 'failed', msg('token_unreadable'));
    throw new MetaError({ code: 190, message: 'token missing' });
  }
  const ctx = {
    token, settings, signal: state.abort.signal,
    report: (phase) => { state.phase = phase; progress(); },
    log: (e) => { state.errors += 1; logError(runId, e); },
  };

  const wrap = (label, fn) => async () => {
    if (state.abort.signal.aborted) return;
    state.currentAccount = label;
    progress();
    try {
      await fn();
    } catch (e) {
      handleJobError(runId, label, e);
    } finally {
      state.done += 1;
      progress();
    }
  };

  const tasks = [];
  if (organicCount) for (const a of accounts) tasks.push(queues.organic.add(wrap(a.username, () => syncOrganicAccount(ctx, a))));
  if (storyCount) for (const a of accounts) tasks.push(queues.stories.add(wrap(`${a.username} (story)`, () => syncStoriesAccount(ctx, a))));
  for (const ad of adAccounts) tasks.push(queues.ads.add(wrap(ad.name, () => syncAdsAccount(ctx, ad))));
  for (const c of competitors) tasks.push(queues.competitors.add(wrap(`@${c.username}`, () => syncCompetitor(ctx, c))));

  Promise.allSettled(tasks).then(() => {
    const status = state.abort.signal.aborted ? 'failed' : state.tokenInvalid ? 'failed' : state.errors ? 'partial' : 'ok';
    finish(runId, status, state.abort.signal.aborted ? msg('sync_cancelled') : state.tokenInvalid ? msg('token_invalid') : state.errors ? msg('sync_errors', { n: state.errors }) : null);
  });
  return { runId, demo: false };
}

function handleJobError(runId, label, e) {
  state.errors += 1;
  const igId = null;
  if (e instanceof MetaError) {
    logError(runId, { igId, endpoint: e.endpoint ?? label, code: e.code, message: e.message });
    if (e.isTokenError) {
      state.tokenInvalid = true;
      emitTokenWarning({ code: e.code, message: e.message });
      cancelSync();
    }
    return;
  }
  if (e instanceof NetworkError) {
    logError(runId, { igId, endpoint: label, code: 0, message: 'network: ' + e.message });
    cancelSync();
    return;
  }
  if (e?.name === 'AbortError') return;
  logError(runId, { igId, endpoint: label, code: -1, message: e?.message ?? String(e) });
}

function finish(runId, status, errorSummary) {
  updateRun(runId, { finishedAt: Date.now(), status, accountsDone: state.done, apiCalls: apiCallsSoFar(), errorSummary });
  Object.assign(state, { running: false, phase: null, currentAccount: null, abort: null });
  emitDone({ runId, status, errors: state.errors, apiCalls: apiCallsSoFar(), tokenInvalid: state.tokenInvalid });
}

async function runDemo(runId, scope, accounts, adAccounts, competitors, progress) {
  const result = await runDemoSync({
    scope, accounts, adAccounts, competitors, signal: state.abort.signal,
    onStep: ({ phase, label, done, apiCalls }) => {
      state.phase = phase; state.currentAccount = label; state.done = done; state.apiCalls = apiCalls;
      emitProgress({ runId, phase, currentAccount: label, done, total: state.total, apiCalls });
    },
  });
  updateRun(runId, { finishedAt: Date.now(), status: state.abort.signal.aborted ? 'failed' : 'ok', accountsDone: state.done, apiCalls: state.apiCalls, errorSummary: state.abort.signal.aborted ? msg('sync_cancelled') : msg('demo_no_api') });
  Object.assign(state, { running: false, phase: null, currentAccount: null, abort: null });
  emitDone({ runId, status: 'ok', errors: 0, apiCalls: result.apiCalls, demo: true });
  void progress;
}

/** Suggests a refresh when the last successful sync is older than 20 hours. */
export function shouldSuggestSync() {
  const last = lastSuccessfulRun();
  if (!last?.finished_at) return { suggest: true, lastSuccessAt: null };
  return { suggest: Date.now() - last.finished_at > 20 * 3_600_000, lastSuccessAt: last.finished_at };
}
