import { q } from '../db/index.js';
import { getTarget, getPost, setPostStatus, WORKER_PLATFORMS } from '../db/queries/planner.js';
import { progressBus } from '../sync/progress.js';
import { getSetting } from '../db/queries/settings.js';
import { msg } from '../i18n.js';
import { createMediaHost } from '../publishing/hosts/index.js';
import { createWorkerClient, WorkerHttpError } from './client.js';
import {
  workerConfig, readSecret, isConfigured, setCursor, setSyncResult, setInfo, itemIdFor,
} from './config.js';
import { applyRemoteTokens, listWorkerTokens } from './tokens.js';
import { buildItem } from './payload.js';

/**
 * Desktop ↔ self-hosted worker sync (plan §4). Not to be confused with src/main/publishing/worker.js (the local tray
 * publishing queue); targets with executor = 'worker' are skipped there and handled here.
 *
 *   syncNow({ reason }) → { pushed, pulled, errors }
 *     1. GET /v1/info (queue, token validity)            3. push dirty targets (revision > worker_revision)
 *     2. recall targets removed/unscheduled locally       4. pull GET /v1/changes?since=worker.cursor → planner state
 *   workerState() → WorkerState (lib/types.ts)
 *   periodic: every 2 min while the app/tray runs, plus shortly after planner changes.
 * The desktop owns content (revision), the worker owns execution state; handover back to the local queue only via recall.
 */
export const SYNC_INTERVAL_MS = 120_000;
export const CHANGE_DEBOUNCE_MS = 5_000;
const PUSH_BATCH = 50;
const PUSHABLE_STATES = ['queued', 'hosting', 'container', 'ready'];
const LOCKED_LOCAL = new Set(['hosting', 'container', 'publishing', 'commenting', 'handed_off', 'published']);
const WORKER_BUSY = new Set(['publishing', 'published']);
const TERMINAL = new Set(['published', 'failed', 'missed']);

let deps = { fetchImpl: null, now: () => Date.now(), convertImage: null, createHost: createMediaHost, steps: null };
let running = null;
let lastState = 'idle';

/** Test/DI hook: { fetchImpl, now, convertImage, createHost, steps }. */
export function setWorkerSyncDeps(overrides = {}) {
  deps = { ...deps, ...overrides };
}

const now = () => deps.now();
const workerError = (key, code, vars = {}) => Object.assign(new Error(msg(key, vars)), { code });

export function getClient() {
  const cfg = workerConfig();
  const secret = readSecret();
  if (!cfg.url || !secret) throw workerError('worker_err_not_configured', 'NOT_CONFIGURED');
  return createWorkerClient({ url: cfg.url, secret, fetchImpl: deps.fetchImpl ?? globalThis.fetch, now });
}

async function stepsApi() {
  if (deps.steps) return deps.steps;
  const { workerOrIdle } = await import('../publishing/worker.js');
  return workerOrIdle().steps;
}

function emitStatus(state) {
  lastState = state;
  const cfg = workerConfig();
  progressBus.emit('worker:status', { configured: isConfigured(), state, lastSyncAt: cfg.lastSyncAt, lastError: cfg.lastError, queue: cfg.info?.queue ?? null });
}

const emitChanged = (postIds, reason) => {
  if (postIds.length) progressBus.emit('planner:changed', { postIds: [...new Set(postIds)], reason, source: 'worker' });
};

const KNOWN_ERRORS = {
  missed: 'worker_missed', uncertain_publish: 'pub_uncertain', container_timeout: 'worker_container_timeout', quota: 'worker_quota',
  token_missing: 'worker_token_missing', token_invalid: 'worker_token_invalid', first_comment_failed: 'worker_first_comment_failed',
};

/** Worker-side error { code, message (a message key or Meta's text) } → user text in the current language. */
export function describeWorkerError(e) {
  if (!e) return null;
  if (KNOWN_ERRORS[e.code]) return msg(KNOWN_ERRORS[e.code]);
  const m = String(e.message ?? '');
  if (/^[a-z][a-z0-9_]+$/.test(m)) {
    const text = msg(m, { detail: e.code ?? '' });
    if (text !== m) return text;
  }
  return msg('worker_failed_detail', { detail: m || e.code || '?' });
}

// ---- state ---------------------------------------------------------------------------------------------------------
export function workerState() {
  const cfg = workerConfig();
  const info = cfg.info ? { version: cfg.info.version, time: cfg.info.time, tz: cfg.info.tz, queue: cfg.info.queue, publicMediaUrl: !!cfg.info.publicMediaUrl } : null;
  return {
    configured: isConfigured(), enabled: cfg.enabled, url: cfg.url, defaultExecutor: cfg.defaultExecutor, lastSyncAt: cfg.lastSyncAt,
    lastError: cfg.lastError, info, tokens: listWorkerTokens(now()), queue: info?.queue ?? null, state: lastState,
    notify: getSetting('notify.worker', true) !== false,
  };
}

function workerTargets() {
  return q.all("SELECT t.*, p.deleted_at AS post_deleted, p.scheduled_at AS post_scheduled_at FROM planner_targets t JOIN planner_posts p ON p.id = t.post_id WHERE t.executor = 'worker'");
}

const WORKER_COLS = { workerRevision: 'worker_revision', workerStatus: 'worker_status', workerError: 'worker_error', workerSyncedAt: 'worker_synced_at', revision: 'revision' };

function setWorker(targetId, patch) {
  const sets = Object.entries(patch).filter(([k]) => WORKER_COLS[k]);
  if (sets.length) q.run(`UPDATE planner_targets SET ${sets.map(([k]) => `${WORKER_COLS[k]} = ?`).join(', ')} WHERE id = ?`, ...sets.map(([, v]) => v), targetId);
}

const errJson = (code, message) => JSON.stringify({ code, message: message ?? null, transient: false });

// ---- push ----------------------------------------------------------------------------------------------------------
async function recallOrphans(client, errors) {
  let recalled = 0;
  for (const r of workerTargets()) {
    if (r.worker_revision == null || WORKER_BUSY.has(r.worker_status)) continue;
    const gone = r.post_deleted != null || r.post_scheduled_at == null || ['idle', 'canceled'].includes(r.state);
    if (!gone) continue;
    try {
      const res = await client.recall(itemIdFor({ id: r.id, postId: r.post_id }), r.worker_revision);
      if (res.recalled) { setWorker(r.id, { workerRevision: null, workerStatus: null, workerError: null, workerSyncedAt: now() }); recalled += 1; }
      else setWorker(r.id, { workerError: errJson(res.code) });
    } catch (e) {
      if (e.code === 'WORKER_OFFLINE') throw e;
      errors.push({ targetId: r.id, code: e.code ?? 'recall_failed' });
    }
  }
  return recalled;
}

/** Failed/missed on the worker, then retried locally (state back to queued) → new revision. */
function markResubmits() {
  const ids = new Set();
  for (const r of workerTargets()) {
    if (r.post_deleted != null || r.state !== 'queued' || !['failed', 'missed'].includes(r.worker_status) || r.revision > (r.worker_revision ?? 0)) continue;
    setWorker(r.id, { revision: (r.worker_revision ?? 0) + 1 });
    ids.add(r.id);
  }
  return ids;
}

function dirtyTargets() {
  const marks = PUSHABLE_STATES.map(() => '?').join(',');
  return q.all(
    `SELECT t.id FROM planner_targets t JOIN planner_posts p ON p.id = t.post_id WHERE t.executor = 'worker' AND p.deleted_at IS NULL
       AND p.scheduled_at IS NOT NULL AND t.state IN (${marks}) AND (t.worker_revision IS NULL OR t.revision > t.worker_revision) ORDER BY p.scheduled_at`,
    ...PUSHABLE_STATES,
  ).map((r) => getTarget(r.id));
}

async function pushDirty(client, info, errors, resubmits) {
  const built = [];
  for (const t of dirtyTargets()) {
    const post = getPost(t.postId);
    if (!post) continue;
    try {
      const publishNow = post.scheduledAt <= now() && (resubmits.has(t.id) || t.workerStatus == null);
      built.push({ t, item: await buildItem({ target: t, post, client, info, convertImage: deps.convertImage, createHost: deps.createHost, now: now(), publishNow }) });
    } catch (e) {
      if (e.code === 'WORKER_OFFLINE') throw e;
      setWorker(t.id, { workerError: errJson(e.code ?? 'build_failed', e.message), workerSyncedAt: now() });
      errors.push({ targetId: t.id, code: e.code ?? 'build_failed', message: e.message });
    }
  }
  let pushed = 0;
  for (let i = 0; i < built.length; i += PUSH_BATCH) {
    const batch = built.slice(i, i + PUSH_BATCH);
    const { results } = await client.pushItems(batch.map((b) => b.item));
    for (const [j, r] of results.entries()) {
      const { t, item } = batch[j];
      if (r.result === 'accepted') {
        setWorker(t.id, { revision: item.revision, workerRevision: r.workerRevision, workerStatus: r.status, workerError: null, workerSyncedAt: now() });
        pushed += 1;
      } else if (r.result === 'conflict' && r.reason === 'stale_revision' && !WORKER_BUSY.has(r.status)) {
        setWorker(t.id, { revision: (r.workerRevision ?? item.revision) + 1 }); // the worker kept a newer copy: overtake next sync
        errors.push({ targetId: t.id, code: 'stale_revision' });
      } else {
        setWorker(t.id, { workerStatus: r.status ?? t.workerStatus ?? null, workerError: errJson(r.reason ?? r.result), workerSyncedAt: now() });
        errors.push({ targetId: t.id, code: r.reason ?? r.result });
      }
    }
  }
  return pushed;
}

// ---- pull ----------------------------------------------------------------------------------------------------------
function localPatch(t, c) {
  if (c.status === 'publishing' && ['queued', 'ready', 'container', 'hosting'].includes(t.state)) return { state: 'publishing', nextAttemptAt: null };
  if (c.status === 'published') {
    const commentFailed = c.lastError?.code === 'first_comment_failed';
    return {
      state: 'published', remoteId: c.remoteId, permalink: c.permalink, mediaKey: c.mediaKey, publishedAt: c.publishedAt ?? now(), nextAttemptAt: null,
      lastErrorCode: commentFailed ? 'first_comment_failed' : null, lastError: commentFailed ? describeWorkerError(c.lastError) : null,
    };
  }
  if (c.status === 'failed') return { state: 'failed', nextAttemptAt: null, lastErrorCode: c.lastError?.code ?? 'worker_failed', lastError: describeWorkerError(c.lastError) };
  if (c.status === 'missed') return { state: 'missed', nextAttemptAt: null, lastErrorCode: 'missed', lastError: describeWorkerError({ code: 'missed' }) };
  return null;
}

async function applyChanges(changes) {
  const byId = new Map(workerTargets().map((r) => [itemIdFor({ id: r.id, postId: r.post_id }), r.id]));
  const steps = await stepsApi();
  const postIds = [];
  let pulled = 0;
  let missed = 0;
  for (const c of changes) {
    const id = byId.get(c.id);
    const t = id != null ? getTarget(id) : null;
    if (!t || c.revision !== t.workerRevision) continue;
    const dirty = t.revision > (t.workerRevision ?? 0); // a newer local edit was refused: keep that push error visible
    setWorker(t.id, { workerStatus: c.status, workerSyncedAt: now(), ...(c.lastError ? { workerError: JSON.stringify(c.lastError) } : dirty ? {} : { workerError: null }) });
    pulled += 1;
    const patch = localPatch(t, c);
    if (!patch || patch.state === t.state) continue;
    steps.set(t, patch, { audit: `worker_${c.status}`, detail: { remoteId: c.remoteId ?? null, code: c.lastError?.code ?? null } });
    if (TERMINAL.has(patch.state)) steps.settlePost(t.postId);
    else if (patch.state === 'publishing' && getPost(t.postId)?.status === 'scheduled') setPostStatus(t.postId, 'publishing', { actor: 'worker', now: now() }); // locks edits
    if (patch.state === 'missed') missed += 1;
    postIds.push(t.postId);
  }
  emitChanged(postIds, 'worker_sync');
  if (missed) progressBus.emit('publish:missed', { count: q.get("SELECT COUNT(*) AS n FROM planner_targets WHERE state = 'missed'").n });
  return pulled;
}

async function pull(client) {
  let cursor = workerConfig().cursor;
  let pulled = 0;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await client.changes(cursor);
    pulled += await applyChanges(page.changes ?? []);
    cursor = page.seq;
    setCursor(cursor);
    if (!page.more) break;
  }
  return pulled;
}

// ---- entry points --------------------------------------------------------------------------------------------------
async function runSync() {
  const client = getClient();
  const errors = [];
  emitStatus('syncing');
  try {
    const info = await client.info();
    setInfo(info);
    applyRemoteTokens(info.tokens ?? []);
    await recallOrphans(client, errors);
    const resubmits = markResubmits();
    const pushed = await pushDirty(client, info, errors, resubmits);
    const pulled = await pull(client);
    setSyncResult({ at: now(), error: errors.length ? msg('worker_sync_partial', { n: errors.length }) : null });
    emitStatus(errors.length ? 'error' : 'idle');
    return { pushed, pulled, errors };
  } catch (e) {
    const offline = e.code === 'WORKER_OFFLINE';
    const text = offline ? msg('worker_err_offline') : e instanceof WorkerHttpError && e.status === 401 ? msg('worker_err_auth') : e.message;
    setSyncResult({ at: workerConfig().lastSyncAt, error: text });
    emitStatus(offline ? 'offline' : 'error');
    throw Object.assign(new Error(text), { code: offline ? 'WORKER_OFFLINE' : e.code ?? 'WORKER_ERROR' });
  }
}

/** One sync pass (concurrent calls share it). `reason` is informational (manual | periodic | planner | executor | cli). */
export function syncNow({ reason = 'manual' } = {}) {
  if (!running) {
    running = runSync().finally(() => { running = null; });
    running.reason = reason;
  }
  return running;
}

let debounce = null;
let listening = false;
function onPlannerChanged(evt) {
  if (!evt || evt.source === 'worker' || !isConfigured() || !workerConfig().enabled) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => { debounce = null; syncNow({ reason: 'planner' }).catch(() => {}); }, CHANGE_DEBOUNCE_MS);
  debounce.unref?.();
}

export const periodic = {
  id: 'worker-sync',
  intervalMs: SYNC_INTERVAL_MS,
  runOnStart: true,
  async run() {
    if (!listening) { progressBus.on('planner:changed', onPlannerChanged); listening = true; }
    if (!isConfigured() || !workerConfig().enabled) return;
    try { await syncNow({ reason: 'periodic' }); } catch (e) { console.warn('[worker] sync failed:', e?.message ?? e); }
  },
};

// ---- executor / recall ---------------------------------------------------------------------------------------------
async function recallTarget(t, client) {
  if (t.workerRevision == null) return { recalled: true };
  const res = await client.recall(itemIdFor(t), t.workerRevision);
  return res.recalled ? { recalled: true } : { recalled: false, reason: res.code ?? 'conflict' };
}

/**
 * worker:setExecutor — moves targets between this computer and the worker. Refused for targets in flight locally.
 * Back to 'local' only after the worker agreed to the recall (409 once it started publishing).
 * @returns {Promise<{ updated: number, skipped: { targetId: number, reason: string }[] }>}
 */
export async function setExecutor({ targetIds, executor } = {}) {
  if (!['local', 'worker'].includes(executor)) throw workerError('worker_err_bad_executor', 'INVALID_PAYLOAD');
  const client = isConfigured() ? getClient() : null;
  if (executor === 'worker' && !client) throw workerError('worker_err_not_configured', 'NOT_CONFIGURED');
  const skipped = [];
  const postIds = [];
  let updated = 0;
  for (const id of (targetIds ?? []).map(Number).filter(Number.isInteger)) {
    const t = getTarget(id);
    if (!t) { skipped.push({ targetId: id, reason: 'not_found' }); continue; }
    if (t.executor === executor) continue;
    if (LOCKED_LOCAL.has(t.state)) { skipped.push({ targetId: id, reason: 'locked' }); continue; }
    if (executor === 'worker') {
      if (!WORKER_PLATFORMS.includes(t.platform)) { skipped.push({ targetId: id, reason: 'platform' }); continue; }
      q.run("UPDATE planner_targets SET executor = 'worker', mode = 'app', container_id = NULL, revision = revision + 1, worker_error = NULL WHERE id = ?", id);
    } else {
      if (t.workerRevision != null && !client) { skipped.push({ targetId: id, reason: 'not_configured' }); continue; }
      if (client) {
        const r = await recallTarget(t, client);
        if (!r.recalled) { skipped.push({ targetId: id, reason: r.reason }); continue; }
      }
      q.run("UPDATE planner_targets SET executor = 'local', worker_revision = NULL, worker_status = NULL, worker_error = NULL WHERE id = ?", id);
    }
    updated += 1;
    postIds.push(t.postId);
  }
  emitChanged(postIds, 'executor');
  if (updated) {
    const { wake } = await import('../publishing/worker.js');
    wake();
    if (executor === 'worker') syncNow({ reason: 'executor' }).catch(() => {});
  }
  return { updated, skipped };
}

/** worker:recall — take one target back to this computer. 409 (already publishing/published) → recalled false. */
export async function recall({ targetId } = {}) {
  const r = await setExecutor({ targetIds: [targetId], executor: 'local' });
  if (r.updated) return { recalled: true };
  return { recalled: false, reason: r.skipped[0]?.reason ?? 'unchanged' };
}
