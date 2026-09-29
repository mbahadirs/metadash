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
import { syncPlatformAccount } from './jobs/platformAccount.js';
import { listProviders, getProvider } from '../providers/index.js';
import { syncStoriesAccount } from './jobs/storiesAccount.js';
import { syncAdsAccount } from './jobs/adsAccount.js';
import { syncCompetitor } from './jobs/competitor.js';
import { runDemoSync } from './demo.js';
import { msg } from '../i18n.js';

/** Shared queues; per-platform organic queues are created lazily by queueFor() with the provider's concurrency. */
export const queues = {
  stories: new PQueue({ concurrency: 2 }),
  ads: new PQueue({ concurrency: 2 }),
  competitors: new PQueue({ concurrency: 1 }),
};

/** Organic queue for a platform (key `organic:<platform>`), created on first use. */
export function queueFor(platform) {
  const key = `organic:${platform}`;
  if (!queues[key]) queues[key] = new PQueue({ concurrency: getProvider(platform)?.concurrency ?? 1 });
  return queues[key];
}

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
  invalidAuth: new Set(),
};

export function syncStatus() {
  const last = lastSuccessfulRun();
  return {
    running: state.running, runId: state.runId, scope: state.scope, phase: state.phase, currentAccount: state.currentAccount,
    done: state.done, total: state.total, apiCalls: state.apiCalls, startedAt: state.startedAt, errors: state.errors,
    lastSuccessAt: last?.finished_at ?? null, rateLimit: rateLimiter.snapshot(), tokenInvalid: state.tokenInvalid,
    invalidAuth: [...state.invalidAuth],
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

const wants = (platforms, platform) => !platforms?.length || platforms.includes(platform);

/**
 * Runs a sync. scope: full | organic | ads | stories | competitors. igIds (account keys) narrows organic/stories work;
 * platforms (['instagram','facebook','threads']) narrows organic work to those platforms (stories/competitors are
 * Instagram-only; ads run when Instagram or Facebook is included).
 */
export async function runSync({ scope = 'full', igIds, platforms } = {}) {
  if (state.running) throw new Error('SYNC_RUNNING');
  const profiles = { meta: getActiveProfile('meta'), threads: getActiveProfile('threads') };
  if (!profiles.meta && !profiles.threads) throw new Error('NO_PROFILE');
  const demo = isDemoProfile(profiles.meta);
  const settings = getAllConfig();
  const byKey = (a) => !igIds?.length || igIds.includes(a.igId);
  const providers = listProviders().filter((p) => wants(platforms, p.platform) && (demo || profiles[p.auth]));
  const enabled = new Set(providers.map((p) => p.platform));
  // Demo mode never calls providers, so it keeps every seeded platform (demo.js walks them).
  let pool = [];
  if (demo) pool = listAccounts({ platforms });
  else if (enabled.size) pool = listAccounts({ platforms: [...enabled] });
  const accounts = pool.filter(byKey);
  const storyAccounts = accounts.filter((a) => (a.platform ?? 'instagram') === 'instagram' && (demo || getProvider('instagram')?.capabilities.stories));
  const metaOk = demo || !!profiles.meta;
  const adAccounts = metaOk && (scope === 'full' || scope === 'ads') && (wants(platforms, 'instagram') || wants(platforms, 'facebook'))
    ? listAdAccounts().filter((a) => a.isTracked && (!igIds?.length || !a.linkedIgId || igIds.includes(a.linkedIgId))) : [];
  const competitors = metaOk && (scope === 'full' || scope === 'competitors') && wants(platforms, 'instagram')
    ? allCompetitors().filter((c) => !igIds?.length || igIds.includes(c.linked_ig_id)) : [];
  const organicAccounts = scope === 'full' || scope === 'organic' ? accounts : [];
  const storyList = scope === 'full' || scope === 'stories' ? storyAccounts : [];
  const total = organicAccounts.length + storyList.length + adAccounts.length + competitors.length;

  const runId = createRun(scope, total);
  Object.assign(state, { running: true, runId, scope, phase: 'accounts', currentAccount: null, done: 0, total, apiCalls: 0, startedAt: Date.now(), abort: new AbortController(), errors: 0, tokenInvalid: false, invalidAuth: new Set() });
  resetApiCalls();
  const progress = () => {
    state.apiCalls = apiCallsSoFar();
    emitProgress({ runId, phase: state.phase, currentAccount: state.currentAccount, done: state.done, total: state.total, apiCalls: state.apiCalls });
  };
  progress();

  if (demo) {
    runDemo(runId, scope, accounts, adAccounts, competitors, progress, storyAccounts).catch(() => {});
    return { runId, demo: true };
  }

  const metaToken = profiles.meta ? readToken(profiles.meta.token_ref) : null;
  if (profiles.meta && !metaToken) {
    finish(runId, 'failed', msg('token_unreadable'));
    throw new MetaError({ code: 190, message: 'token missing' });
  }
  const tokens = new Map(metaToken ? [['meta', metaToken]] : []);
  const ctx = {
    token: metaToken, settings, signal: state.abort.signal, pageTokens: new Map(),
    tokenFor: (auth) => {
      if (tokens.has(auth)) return tokens.get(auth);
      const t = profiles[auth] ? readToken(profiles[auth].token_ref) : null;
      if (!t) throw new MetaError({ code: 190, message: `${auth} token missing`, source: auth });
      tokens.set(auth, t);
      return t;
    },
    report: (phase) => { state.phase = phase; progress(); },
    log: (e) => { state.errors += 1; logError(runId, e); },
  };

  const wrap = (job, fn) => async () => {
    if (state.abort.signal.aborted) return;
    if (job.auth && state.invalidAuth.has(job.auth)) { state.done += 1; progress(); return; }
    state.currentAccount = job.label;
    progress();
    try {
      await fn();
    } catch (e) {
      handleJobError(runId, job, e);
    } finally {
      state.done += 1;
      progress();
    }
  };
  const accountJob = (a, provider, suffix = provider.labelSuffix ?? '') => ({ label: `${a.username}${suffix}`, igId: a.igId, platform: provider.platform, auth: provider.auth });

  const tasks = [];
  for (const a of organicAccounts) {
    const provider = getProvider(a.platform ?? 'instagram');
    if (!provider) continue;
    tasks.push(queueFor(provider.platform).add(wrap(accountJob(a, provider), () => syncPlatformAccount(ctx, provider, a))));
  }
  const ig = getProvider('instagram');
  for (const a of storyList) tasks.push(queues.stories.add(wrap(accountJob(a, ig, ' (story)'), () => syncStoriesAccount(ctx, a))));
  for (const ad of adAccounts) tasks.push(queues.ads.add(wrap({ label: ad.name, igId: ad.linkedIgId ?? null, platform: null, auth: 'meta' }, () => syncAdsAccount(ctx, ad))));
  for (const c of competitors) tasks.push(queues.competitors.add(wrap({ label: `@${c.username}`, igId: c.linked_ig_id ?? null, platform: 'instagram', auth: 'meta' }, () => syncCompetitor(ctx, c))));

  Promise.allSettled(tasks).then(() => {
    const status = state.abort.signal.aborted ? 'failed' : state.tokenInvalid ? 'failed' : state.errors ? 'partial' : 'ok';
    finish(runId, status, state.abort.signal.aborted ? msg('sync_cancelled') : state.tokenInvalid ? msg('token_invalid') : state.errors ? msg('sync_errors', { n: state.errors }) : null);
  });
  return { runId, demo: false };
}

/**
 * Logs a failed job with its account key + platform. A token error marks that auth profile invalid and emits
 * token:warning { platform: auth, code, message }; only a Meta token error aborts the whole run (Threads jobs are
 * skipped by wrap() instead). Network errors abort the run.
 */
function handleJobError(runId, job, e) {
  state.errors += 1;
  const { igId = null, platform = null, label } = job;
  if (e instanceof MetaError) {
    logError(runId, { igId, platform, endpoint: e.endpoint ?? label, code: e.code, message: e.message });
    if (e.isTokenError) {
      const auth = job.auth ?? 'meta';
      const first = !state.invalidAuth.has(auth);
      state.invalidAuth.add(auth);
      if (first) emitTokenWarning({ platform: auth, code: e.code, message: e.message });
      if (auth === 'meta') {
        state.tokenInvalid = true;
        cancelSync();
      }
    }
    return;
  }
  if (e instanceof NetworkError) {
    logError(runId, { igId, platform, endpoint: label, code: 0, message: 'network: ' + e.message });
    cancelSync();
    return;
  }
  if (e?.name === 'AbortError') return;
  logError(runId, { igId, platform, endpoint: label, code: -1, message: e?.message ?? String(e) });
}

function finish(runId, status, errorSummary) {
  updateRun(runId, { finishedAt: Date.now(), status, accountsDone: state.done, apiCalls: apiCallsSoFar(), errorSummary });
  Object.assign(state, { running: false, phase: null, currentAccount: null, abort: null });
  emitDone({ runId, status, errors: state.errors, apiCalls: apiCallsSoFar(), tokenInvalid: state.tokenInvalid, invalidAuth: [...state.invalidAuth] });
}

async function runDemo(runId, scope, accounts, adAccounts, competitors, progress, storyAccounts) {
  const result = await runDemoSync({
    scope, accounts, storyAccounts, adAccounts, competitors, signal: state.abort.signal,
    onStep: ({ phase, label, done, apiCalls }) => {
      state.phase = phase; state.currentAccount = label; state.done = done; state.apiCalls = apiCalls;
      emitProgress({ runId, phase, currentAccount: label, done, total: state.total, apiCalls });
    },
  });
  updateRun(runId, { finishedAt: Date.now(), status: state.abort.signal.aborted ? 'failed' : 'ok', accountsDone: state.done, apiCalls: state.apiCalls, errorSummary: state.abort.signal.aborted ? msg('sync_cancelled') : msg('demo_no_api') });
  Object.assign(state, { running: false, phase: null, currentAccount: null, abort: null });
  emitDone({ runId, status: 'ok', errors: 0, apiCalls: result.apiCalls, demo: true, tokenInvalid: false, invalidAuth: [] });
  void progress;
}

/** Suggests a refresh when the last successful sync is older than 20 hours. */
export function shouldSuggestSync() {
  const last = lastSuccessfulRun();
  if (!last?.finished_at) return { suggest: true, lastSuccessAt: null };
  return { suggest: Date.now() - last.finished_at > 20 * 3_600_000, lastSuccessAt: last.finished_at };
}
