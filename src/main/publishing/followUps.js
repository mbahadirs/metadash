import { getTarget, getPost, setPostStatus, plannerError } from '../db/queries/planner.js';
import { leaseTarget, releaseTarget } from '../db/queries/planner.js';
import { classify } from './errors.js';
import { jobMedia } from './steps.js';
import { firstAttemptAt, insideNativeWindow, nextReconcileAt, HOUR } from './timing.js';
import { LIMITS } from './limits.js';

/**
 * Reactions to planner changes made outside the worker (chunk A's follow-ups), run one at a time:
 *  - rescheduled: recompute next_attempt_at of queued/ready targets, requeue missed ones, move FB native posts
 *    (POST /{id} scheduled_publish_time; on failure DELETE + recreate); scheduledAt null → unschedule
 *  - edited / approval_invalidated with remoteCancelTargetIds: cancel the FB scheduled post, then recreate it with the
 *    new content (still scheduled) or leave the target idle (approval withdrawn)
 *  - deleted with handedOffTargetIds: cancel the FB scheduled post (unless cancelRemote === false), target → canceled
 * Also exports unschedule/cancel helpers used by the publishing IPC actions.
 */
const LEASE_TRIES = 20;
const LEASE_WAIT_MS = 3000;
const CONTAINER_TTL_MS = LIMITS.instagram.containerTtlHours * HOUR;
const LOCKED_STATES = new Set(['publishing', 'commenting']);

export function createFollowUps({ deps, steps, buildJob, emitChanged, owner }) {
  const now = () => deps.now();
  let chain = Promise.resolve();
  let pending = 0;
  const sleep = (ms) => new Promise((r) => deps.setTimer(r, ms));

  function enqueue(fn) {
    pending += 1;
    const p = chain.then(fn).catch((e) => console.error('[publishing] follow-up failed:', e?.message ?? e)).finally(() => { pending -= 1; });
    chain = p;
    return p;
  }

  async function withLease(targetId, fn) {
    for (let i = 0; i < LEASE_TRIES; i += 1) {
      if (leaseTarget(targetId, owner(), now())) {
        try { return await fn(getTarget(targetId)); } finally { releaseTarget(targetId, owner()); }
      }
      await sleep(LEASE_WAIT_MS);
    }
    throw plannerError('planner_target_locked', 'TARGET_LOCKED');
  }

  const jobFor = (target, post) => buildJob(target, post, deps.makeContext());

  /** DELETE the FB scheduled post. Errors are recorded on the target and rethrown. */
  async function cancelRemote(target, post) {
    const job = jobFor(target, post);
    if (!job.publisher?.cancelNative || !target.containerId) return;
    try {
      await job.publisher.cancelNative(job.ctx, job);
      steps.set(target, {}, { audit: 'native_canceled', detail: { containerId: target.containerId } });
    } catch (e) {
      const c = classify(e);
      steps.set(target, { lastErrorCode: c.code, lastError: c.message, fbtraceId: c.fbtraceId ?? null }, { audit: 'native_cancel_failed', detail: { code: c.code, message: c.message } });
      throw e;
    }
  }

  async function rescheduleNative(target, post) {
    const at = post.scheduledAt;
    const job = jobFor(target, post);
    if (insideNativeWindow(at, now())) {
      try {
        await job.publisher.reschedule(job.ctx, job, at);
        steps.set(target, { nextAttemptAt: nextReconcileAt(at, now()) }, { audit: 'native_rescheduled', detail: { at } });
        return;
      } catch (e) {
        console.warn('[publishing] native reschedule failed, recreating:', e?.message ?? e);
      }
    }
    await cancelRemote(target, post);
    steps.set(target, { state: 'queued', containerId: null, nextAttemptAt: now() }, { audit: 'native_recreate', detail: { at } });
  }

  async function recompute(postId) {
    const post = getPost(postId);
    if (!post) return;
    if (post.scheduledAt == null) return unscheduleTargets(postId, { actor: 'system' });
    const media = jobMedia(post).media.map((m) => m.asset);
    let requeued = false;
    for (const t of post.targets) {
      await withLease(t.id, async (cur) => {
        if (!cur) return;
        const first = firstAttemptAt({ target: cur, scheduledAt: post.scheduledAt, media, now: now() });
        if (cur.state === 'queued' || (cur.state === 'missed' && cur.mode === 'app')) {
          requeued ||= cur.state === 'missed';
          steps.set(cur, { state: 'queued', attempts: cur.state === 'missed' ? 0 : cur.attempts, nextAttemptAt: first, ...(cur.state === 'missed' ? { lastErrorCode: null, lastError: null } : {}) }, cur.state === 'missed' ? { audit: 'requeued' } : { progress: false });
        } else if (cur.state === 'ready') {
          if (post.scheduledAt - now() > CONTAINER_TTL_MS - HOUR) steps.set(cur, { state: 'queued', containerId: null, nextAttemptAt: first }, { audit: 'container_dropped', detail: { reason: 'rescheduled' } });
          else steps.set(cur, { nextAttemptAt: Math.max(now(), post.scheduledAt) }, { progress: false });
        } else if (cur.state === 'handed_off') {
          await rescheduleNative(cur, post);
        }
      });
    }
    if (requeued && (post.status === 'failed' || post.status === 'partial')) setPostStatus(postId, 'scheduled', { actor: 'system', now: now() });
    emitChanged([postId], 'requeued');
  }

  async function recreateNative(targetIds) {
    const touched = new Set();
    for (const id of targetIds ?? []) {
      await withLease(id, async (t) => {
        if (!t || t.state !== 'handed_off') return;
        const post = getPost(t.postId);
        await cancelRemote(t, post);
        const scheduled = post?.status === 'scheduled';
        steps.set(t, { state: scheduled ? 'queued' : 'idle', containerId: null, nextAttemptAt: scheduled ? now() : null }, { audit: scheduled ? 'native_recreate' : 'native_withdrawn' });
        touched.add(t.postId);
      });
    }
    if (touched.size) emitChanged([...touched], 'requeued');
  }

  async function cancelDeleted(targetIds, cancelRemoteFlag) {
    for (const id of targetIds ?? []) {
      await withLease(id, async (t) => {
        if (!t || t.state !== 'handed_off') return;
        const post = getPost(t.postId, { includeDeleted: true });
        if (cancelRemoteFlag !== false) {
          try { await cancelRemote(t, post); } catch { /* recorded on the target */ }
        }
        steps.set(t, { state: 'canceled', nextAttemptAt: null }, { audit: cancelRemoteFlag === false ? 'remote_kept' : 'canceled' });
      });
    }
  }

  /**
   * Takes every pending target of a post back to idle (FB native posts are deleted on Facebook first) and the post back
   * to draft. Refuses (POST_LOCKED) while a publish call may be in flight.
   */
  async function unscheduleTargets(postId, { actor = 'user' } = {}) {
    const post = getPost(postId);
    if (!post) throw plannerError('planner_post_not_found', 'NOT_FOUND');
    if (post.targets.some((t) => LOCKED_STATES.has(t.state))) throw plannerError('planner_post_locked', 'POST_LOCKED');
    for (const t of post.targets) {
      await withLease(t.id, async (cur) => {
        if (!cur || ['published', 'failed', 'canceled', 'idle'].includes(cur.state)) return;
        if (LOCKED_STATES.has(cur.state)) throw plannerError('planner_post_locked', 'POST_LOCKED');
        if (cur.state === 'handed_off') await cancelRemote(cur, post);
        steps.set(cur, { state: 'idle', containerId: null, nextAttemptAt: null, attempts: 0 }, { audit: 'unscheduled' });
      });
    }
    const cur = getPost(postId);
    if (cur?.status === 'scheduled') setPostStatus(postId, 'draft', { actor, now: now() });
    emitChanged([postId], 'unscheduled');
  }

  async function handle(evt) {
    const ids = evt.postIds ?? [];
    if (evt.reason === 'rescheduled') return enqueue(async () => { for (const id of ids) await recompute(id); });
    if ((evt.reason === 'edited' || evt.reason === 'approval_invalidated') && evt.remoteCancelTargetIds?.length) return enqueue(() => recreateNative(evt.remoteCancelTargetIds));
    if (evt.reason === 'deleted' && evt.handedOffTargetIds?.length) return enqueue(() => cancelDeleted(evt.handedOffTargetIds, evt.cancelRemote));
    return undefined;
  }

  return {
    handle,
    enqueue,
    withLease,
    cancelRemote,
    recompute,
    unscheduleTargets,
    busy: () => pending > 0,
    idle: () => chain,
  };
}
