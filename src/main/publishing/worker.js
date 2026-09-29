import crypto from 'node:crypto';
import { q } from '../db/index.js';
import { getConfig } from '../config/store.js';
import { getAccount } from '../db/queries/accounts.js';
import { getTarget, getPost, listTargets, leaseTarget, releaseTarget } from '../db/queries/planner.js';
import { progressBus } from '../sync/progress.js';
import { msg } from '../i18n.js';
import { getPublisher } from './platforms/index.js';
import { createMediaHost } from './hosts/index.js';
import { createPublishContext, isDemoMode, tokenFingerprint, authOf } from './context.js';
import { createPublishNotifier } from './notify.js';
import { createSteps, jobMedia, PENDING_STATES } from './steps.js';
import { createFollowUps } from './followUps.js';
import { MAX_TIMER_MS, MIN, nextReconcileAt } from './timing.js';
import { electronConvertImage, electronKeepAwake } from './electronAdapters.js';

/**
 * Publishing queue worker (plan §6.7).
 *  - One timer, set to the earliest due target (capped at 60 s so wall-clock jumps are noticed). wake() re-runs now;
 *    it is called on planner:changed and (by chunk C) on powerMonitor resume/unlock-screen.
 *  - Up to `concurrency` (2) targets at a time, one per account; each holds a DB lease (planner_targets.locked_at /
 *    lock_owner, 10 min stale) for the duration of one step.
 *  - planner.paused stops new steps (the one in flight finishes).
 *  - Missed while asleep: queued/ready app-mode targets more than planner.missedGraceMin late are handled per
 *    planner.missedPolicy (ask → missed + publish:missed + notification; skip → missed; publish → still published
 *    when at most planner.maxLateMin late).
 * Dependencies are injected (tests use a fake clock and fake publishers).
 */
const DUE_STATES = PENDING_STATES.filter((s) => s !== 'paused');
const MISSABLE_STATES = ['queued', 'ready'];
const FIRST_TICK_MS = 1000;

export function defaultDeps(overrides = {}) {
  const isDemo = overrides.isDemo ?? isDemoMode;
  return {
    now: Date.now,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
    emit: (evt, payload) => progressBus.emit(evt, payload),
    on: (evt, fn) => { progressBus.on(evt, fn); return () => progressBus.off(evt, fn); },
    getPublisher,
    createHost: () => createMediaHost(),
    makeContext: () => createPublishContext(),
    convertImage: null,
    config: getConfig,
    isDemo,
    tokenFingerprint,
    keepAwake: null,
    owner: crypto.randomUUID(),
    concurrency: 2,
    notifier: overrides.notifier ?? createPublishNotifier({ isDemo }),
    ...overrides,
  };
}

/** Earliest next_attempt_at among due-able targets of live posts. */
function earliestDue() {
  const marks = DUE_STATES.map(() => '?').join(',');
  return q.get(`SELECT MIN(t.next_attempt_at) AS at FROM planner_targets t JOIN planner_posts p ON p.id = t.post_id WHERE p.deleted_at IS NULL AND t.state IN (${marks})`, ...DUE_STATES)?.at ?? null;
}

/** Next scheduled item (tray status line). @returns {null | { targetId, postId, ref, title, accountId, platform, mode, state, scheduledAt, nextAttemptAt }} */
export function nextDue({ now = Date.now() } = {}) {
  const marks = DUE_STATES.map(() => '?').join(',');
  const r = q.get(
    `SELECT t.id, t.post_id, t.account_id, t.platform, t.mode, t.state, t.next_attempt_at, p.ref, p.title, p.scheduled_at FROM planner_targets t JOIN planner_posts p ON p.id = t.post_id
     WHERE p.deleted_at IS NULL AND t.state IN (${marks}) AND p.scheduled_at IS NOT NULL AND p.scheduled_at >= ? ORDER BY p.scheduled_at, t.id LIMIT 1`,
    ...DUE_STATES, now - 60 * MIN,
  );
  return r ? { targetId: r.id, postId: r.post_id, ref: r.ref, title: r.title, accountId: r.account_id, platform: r.platform, mode: r.mode, state: r.state, scheduledAt: r.scheduled_at, nextAttemptAt: r.next_attempt_at } : null;
}

/** App-mode targets due in [from, to) (tray "N posts today", quit confirmation). */
export function countDue({ from, to, mode = 'app' } = {}) {
  const marks = DUE_STATES.map(() => '?').join(',');
  return q.get(
    `SELECT COUNT(*) AS n FROM planner_targets t JOIN planner_posts p ON p.id = t.post_id WHERE p.deleted_at IS NULL AND t.state IN (${marks}) AND t.mode = ? AND p.scheduled_at >= ? AND p.scheduled_at < ?`,
    ...DUE_STATES, mode, from, to,
  ).n;
}

export function createWorker(overrides = {}) {
  const deps = defaultDeps(overrides);
  const now = () => deps.now();
  const inFlight = new Map(); // targetId → promise
  const busyAccounts = new Set();
  const pausedAuth = new Map();
  let timer = null;
  let started = false;
  let ticking = null;
  let again = false;
  let awakeId = null;
  let unsubscribe = null;

  const emitChanged = (postIds, reason, extra = {}) => deps.emit('planner:changed', { postIds, reason, source: 'worker', ...extra });
  const steps = createSteps({ deps, emit: deps.emit, emitChanged, notifier: deps.notifier, pausedAuth });
  const paused = () => deps.config('planner.paused') === true;

  function buildJob(target, post, ctx) {
    const demo = deps.isDemo();
    const publisher = deps.getPublisher(target.platform, { demo });
    const account = getAccount(target.accountId);
    return { target, post, account, publisher, ctx, demo, ...jobMedia(post) };
  }

  const followUps = createFollowUps({ deps, steps, buildJob, emitChanged, owner: () => deps.owner });

  function keepAwake(on) {
    if (!deps.keepAwake) return;
    try {
      if (on && awakeId == null) awakeId = deps.keepAwake.start();
      if (!on && awakeId != null) { deps.keepAwake.stop(awakeId); awakeId = null; }
    } catch (e) { console.warn('[publishing] keep-awake failed:', e?.message ?? e); }
  }

  async function runTarget(id) {
    if (!leaseTarget(id, deps.owner, now())) return;
    try {
      const target = getTarget(id);
      if (!target || !DUE_STATES.includes(target.state) || target.nextAttemptAt == null || target.nextAttemptAt > now()) return;
      const post = getPost(target.postId);
      if (!post) return;
      const job = buildJob(target, post, deps.makeContext());
      if (!job.publisher) return steps.fail(job, { kind: 'config', code: 'unsupported_platform', message: msg('invalid_platform', { p: target.platform }), fbtraceId: null });
      if (!job.account && !job.demo) return steps.fail(job, { kind: 'config', code: 'account_missing', message: msg('pub_account_missing'), fbtraceId: null });
      await steps.run(job);
    } finally {
      releaseTarget(id, deps.owner);
    }
  }

  function detectMissed() {
    const t0 = now();
    const grace = Math.max(0, Number(deps.config('planner.missedGraceMin')) || 0) * MIN;
    const maxLate = Math.max(0, Number(deps.config('planner.maxLateMin')) || 0) * MIN;
    const policy = deps.config('planner.missedPolicy') ?? 'ask';
    const late = listTargets({ states: MISSABLE_STATES }).filter((t) => t.mode !== 'native' && !t.attempts && t.nextAttemptAt != null
      && t.nextAttemptAt < t0 - grace && (t.scheduledAt ?? t.nextAttemptAt) < t0 - grace && !inFlight.has(t.id));
    const missed = late.filter((t) => !(policy === 'publish' && t0 - (t.scheduledAt ?? t.nextAttemptAt) <= maxLate));
    for (const t of missed) {
      const lateMin = Math.round((t0 - (t.scheduledAt ?? t.nextAttemptAt)) / MIN);
      steps.set(t, { state: 'missed', nextAttemptAt: null, lastErrorCode: 'missed', lastError: msg('pub_missed', { min: lateMin }) }, { audit: 'missed', detail: { lateMin, policy } });
    }
    if (!missed.length) return 0;
    for (const postId of new Set(missed.map((t) => t.postId))) steps.settlePost(postId);
    const count = listTargets({ states: ['missed'] }).length;
    if (policy === 'ask') {
      deps.emit('publish:missed', { count });
      deps.notifier.missed(missed.length);
    }
    emitChanged([...new Set(missed.map((t) => t.postId))], 'missed');
    return missed.length;
  }

  /** Auth-paused targets go back to the queue once that auth's token changed (reconnected) or after a restart. */
  function resumeAuth() {
    const paused = listTargets({ states: ['paused'] });
    if (!paused.length) return;
    const resumed = [];
    for (const t of paused) {
      const auth = authOf(t.platform);
      const fp = deps.tokenFingerprint(auth);
      if (!fp || (pausedAuth.has(auth) && pausedAuth.get(auth) === fp)) continue;
      steps.set(t, { state: 'queued', nextAttemptAt: now(), lastErrorCode: null, lastError: null }, { audit: 'resumed', detail: { auth } });
      resumed.push(t);
    }
    for (const auth of new Set(resumed.map((t) => authOf(t.platform)))) pausedAuth.delete(auth);
    if (resumed.length) emitChanged([...new Set(resumed.map((t) => t.postId))], 'resumed');
  }

  function dispatch() {
    const limit = Math.max(1, deps.concurrency);
    for (const t of listTargets({ states: DUE_STATES, dueBefore: now() })) {
      if (inFlight.size >= limit) break;
      if (inFlight.has(t.id) || busyAccounts.has(t.accountId)) continue;
      busyAccounts.add(t.accountId);
      keepAwake(true);
      const p = runTarget(t.id)
        .catch((e) => console.error('[publishing] worker step crashed:', e))
        .finally(() => {
          inFlight.delete(t.id);
          busyAccounts.delete(t.accountId);
          if (!inFlight.size) keepAwake(false);
          if (started) wake();
        });
      inFlight.set(t.id, p);
    }
  }

  function schedule() {
    if (!started) return;
    if (timer) deps.clearTimer(timer);
    const at = paused() ? null : earliestDue();
    const delay = at == null ? MAX_TIMER_MS : Math.min(MAX_TIMER_MS, Math.max(0, at - now()));
    timer = deps.setTimer(() => { timer = null; tick(); }, delay);
  }

  /** One pass: resume auth, detect missed posts, start due steps. Concurrent calls coalesce. */
  function tick() {
    if (ticking) { again = true; return ticking; }
    ticking = (async () => {
      await null; // let `ticking` be assigned before the body (it is synchronous) finishes
      try {
        resumeAuth();
        detectMissed();
        if (!paused()) dispatch();
      } catch (e) {
        console.error('[publishing] tick failed:', e);
      } finally {
        ticking = null;
        schedule();
        if (again) { again = false; tick(); }
      }
    })();
    return ticking;
  }

  function wake() {
    if (!started) return;
    if (timer) { deps.clearTimer(timer); timer = null; }
    timer = deps.setTimer(() => { timer = null; tick(); }, 0);
  }

  /** Releases leases of other (dead) processes; safe because chunk C holds the single-instance lock. */
  function recoverLeases() {
    q.run('UPDATE planner_targets SET locked_at = NULL, lock_owner = NULL WHERE lock_owner IS NOT NULL AND lock_owner <> ?', deps.owner);
  }

  /** FB native targets handed off elsewhere (demo seed, older builds) without a reconcile time get one. */
  function normalizeHandedOff() {
    for (const t of listTargets({ states: ['handed_off'] })) {
      if (t.nextAttemptAt != null) continue;
      steps.set(t, { nextAttemptAt: t.scheduledAt != null ? nextReconcileAt(t.scheduledAt, now()) ?? now() : now() }, { progress: false });
    }
  }

  function onChanged(evt) {
    if (!evt || evt.source === 'worker') return;
    followUps.handle(evt).catch((e) => console.error('[publishing] follow-up failed:', e)).finally(() => wake());
  }

  return {
    owner: deps.owner,
    start() {
      if (started) return;
      started = true;
      recoverLeases();
      normalizeHandedOff();
      unsubscribe = deps.on ? deps.on('planner:changed', onChanged) : null;
      timer = deps.setTimer(() => { timer = null; tick(); }, FIRST_TICK_MS);
    },
    stop() {
      started = false;
      if (timer) deps.clearTimer(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
      keepAwake(false);
    },
    tick,
    wake,
    /** Resolves once every in-flight step (and follow-up) has finished (tests, quit). */
    async idle() {
      while (inFlight.size || ticking || followUps.busy()) await Promise.all([...inFlight.values(), ticking, followUps.idle()]);
    },
    handleChanged: (evt) => followUps.handle(evt),
    followUps,
    status: () => ({ paused: paused(), running: started, nextAt: earliestDue(), inFlight: inFlight.size }),
    nextDue: () => nextDue({ now: now() }),
    steps,
  };
}

// ---- process singleton (chunk C wires startPublishing into the app lifecycle) --------------------------------------
let worker = null;

/**
 * Starts the background worker (idempotent: restarts with the new deps). Chunk C calls it after openDb():
 *   startPublishing()  — optional overrides for tests. Also: stopPublishing(), wake(), nextDue(), countDue(), publishingStatus().
 */
export function startPublishing(overrides = {}) {
  stopPublishing();
  worker = createWorker({ convertImage: electronConvertImage, keepAwake: electronKeepAwake(), ...overrides });
  worker.start();
  return worker;
}

export function stopPublishing() {
  worker?.stop();
  worker = null;
}

/** Re-runs the worker now (powerMonitor resume/unlock-screen, settings changes). No-op when not started. */
export function wake() {
  worker?.wake();
}

export const getWorker = () => worker;

export function publishingStatus() {
  if (worker) return worker.status();
  return { paused: getConfig('planner.paused') === true, running: false, nextAt: earliestDue(), inFlight: 0 };
}

let idleWorker = null;
/** The running worker, or an unstarted one (its steps/follow-ups still work) for IPC actions before start. */
export function workerOrIdle() {
  return worker ?? (idleWorker ??= createWorker({ convertImage: electronConvertImage }));
}

/** Test hook: drop the cached idle worker (e.g. after swapping DBs). */
export function resetIdleWorker() {
  idleWorker = null;
}
