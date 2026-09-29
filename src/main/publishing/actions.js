import { getConfig, setConfig } from '../config/store.js';
import { getAccount } from '../db/queries/accounts.js';
import {
  requirePost, getPost, getTarget, listTargets, reschedulePost, setPostStatus, postAssets, getQuota, setQuota, plannerError, addAudit,
} from '../db/queries/planner.js';
import { validatePostLike } from '../planner/validationContext.js';
import { publishCapabilitiesFor } from './capabilities.js';
import { LIMITS } from './limits.js';
import { publishError } from './errors.js';
import { getPublisher } from './platforms/index.js';
import { createPublishContext, isDemoMode } from './context.js';
import { jobMedia } from './steps.js';
import { firstAttemptAt, QUOTA_CACHE_MS } from './timing.js';
import { workerOrIdle, wake } from './worker.js';
import { progressBus } from '../sync/progress.js';

/**
 * Publishing actions behind the publishing:* IPC channels (thin handlers in ipc/publishing.handlers.js).
 * Every change emits planner:changed (source 'worker' so the worker's own follow-up listener ignores it) and wakes
 * the worker.
 */
const QUEUEABLE = new Set(['idle', 'failed', 'missed', 'paused']);
const RETRYABLE = new Set(['failed', 'missed', 'paused', 'canceled']);
const LOCKED = new Set(['publishing', 'commenting']);
export const DEFAULT_QUEUE_STATES = Object.freeze(['queued', 'hosting', 'container', 'ready', 'handed_off', 'publishing', 'commenting', 'paused', 'failed', 'missed']);

const emitChanged = (postIds, reason, extra = {}) => progressBus.emit('planner:changed', { postIds, reason, source: 'worker', ...extra });
const requireApproval = () => getConfig('planner.requireApproval') === true;
const ops = () => workerOrIdle();

function statusError(reason) {
  const key = reason === 'approval_required' ? 'pub_approval_required' : 'pub_status_not_allowed';
  return publishError(key, { reason }, { code: reason === 'approval_required' ? 'APPROVAL_REQUIRED' : 'STATUS_NOT_ALLOWED' });
}

/** Moves a post to `scheduled` (from draft/approved/failed/partial) unless it already is. */
function ensureScheduled(post, now) {
  if (post.status === 'scheduled' || post.status === 'publishing') return;
  const r = setPostStatus(post.id, 'scheduled', { actor: 'user', requireApproval: requireApproval(), now });
  if (!r.ok) throw statusError(r.reason);
}

function validationErrors(post, now) {
  const issues = validatePostLike(post, { now });
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) throw Object.assign(publishError('pub_validation_failed', { n: errors.length }, { code: 'VALIDATION_FAILED' }), { issues: errors });
  return issues;
}

/** publishing:schedule — validation + status machine, then targets → queued (FB native: hand-off right away). */
export function schedule(id, { now = Date.now() } = {}) {
  const post = requirePost(id);
  if (post.scheduledAt == null) throw publishError('pub_no_time', {}, { code: 'NO_TIME' });
  if (post.scheduledAt < now - LIMITS.common.pastGraceMs) throw plannerError('planner_time_past', 'TIME_PAST');
  if (post.status === 'publishing' || post.status === 'published') throw plannerError('planner_post_locked', 'POST_LOCKED');
  const issues = validationErrors(post, now);
  ensureScheduled(post, now);
  const media = jobMedia(post).media.map((m) => m.asset);
  let queued = 0;
  let handedOff = 0;
  const { steps } = ops();
  for (const t of post.targets) {
    if (!QUEUEABLE.has(t.state)) continue;
    const native = t.mode === 'native' && publishCapabilitiesFor(t.platform)?.nativeSchedule;
    steps.set(t, { state: 'queued', attempts: 0, containerId: null, nextAttemptAt: firstAttemptAt({ target: t, scheduledAt: post.scheduledAt, media, now }), lastErrorCode: null, lastError: null, fbtraceId: null }, { audit: 'queued', detail: { mode: t.mode } });
    if (native) handedOff += 1;
    else queued += 1;
  }
  emitChanged([id], 'scheduled');
  wake();
  return { queued, handedOff, warnings: issues.filter((i) => i.level === 'warn') };
}

/** publishing:unschedule — back to draft; FB native posts are deleted on Facebook. */
export async function unschedule(id) {
  await ops().followUps.unscheduleTargets(id, { actor: 'user' });
  wake();
  return null;
}

/** publishing:publishNow — moves the post time to now and queues the chosen (or all pending) targets in app mode. */
export async function publishNow({ id, targetIds } = {}, { now = Date.now() } = {}) {
  const post = requirePost(id);
  if (post.status === 'publishing' || post.status === 'published') throw plannerError('planner_post_locked', 'POST_LOCKED');
  validationErrors({ ...post, scheduledAt: now }, now);
  const wanted = targetIds?.length ? new Set(targetIds.map(Number)) : null;
  const picked = post.targets.filter((t) => (!wanted || wanted.has(t.id)) && (QUEUEABLE.has(t.state) || ['queued', 'ready', 'handed_off'].includes(t.state)));
  if (!picked.length) throw publishError('pub_nothing_to_publish', {}, { code: 'NOTHING_TO_PUBLISH' });
  ensureScheduled(post, now);
  reschedulePost(id, now, { now });
  const { steps, followUps } = ops();
  for (const t of picked) {
    if (t.state === 'handed_off') await followUps.withLease(t.id, (cur) => followUps.cancelRemote(cur, post));
    const cur = getTarget(t.id);
    const keepContainer = cur.state === 'ready';
    steps.set(cur, { state: keepContainer ? 'ready' : 'queued', mode: 'app', attempts: 0, nextAttemptAt: now, ...(keepContainer ? {} : { containerId: null }), lastErrorCode: null, lastError: null }, { audit: 'publish_now' });
  }
  emitChanged([id], 'publish_now', { scheduledAt: now });
  wake();
  return null;
}

function thumbOf(postId, cache) {
  if (!cache.has(postId)) {
    const first = postAssets(postId).find((a) => a.role === 'media' && a.position === 0);
    cache.set(postId, first ? { assetId: first.assetId, kind: first.asset.kind } : null);
  }
  return cache.get(postId);
}

/** publishing:queue — targets (with post ref/title/time/thumb) in the given states. */
export function queue({ states } = {}) {
  const wanted = Array.isArray(states) && states.length ? states.filter((s) => typeof s === 'string') : DEFAULT_QUEUE_STATES;
  const thumbs = new Map();
  return listTargets({ states: wanted }).map((t) => ({ ...t, thumb: thumbOf(t.postId, thumbs) }));
}

export const missed = () => queue({ states: ['missed'] });

/** publishing:retry — failed/missed/paused/canceled target back to the queue (post back to scheduled). */
export function retry(targetId, { now = Date.now() } = {}) {
  const t = getTarget(targetId);
  if (!t) throw plannerError('planner_post_not_found', 'NOT_FOUND');
  if (!RETRYABLE.has(t.state)) throw publishError('pub_target_not_retryable', { state: t.state }, { code: 'NOT_RETRYABLE' });
  const post = requirePost(t.postId);
  ensureScheduled(post, now);
  const media = jobMedia(post).media.map((m) => m.asset);
  const future = post.scheduledAt != null && post.scheduledAt > now;
  const mode = t.mode === 'native' && !future ? 'app' : t.mode;
  ops().steps.set(t, { state: 'queued', mode, attempts: 0, containerId: null, lastErrorCode: null, lastError: null, fbtraceId: null, nextAttemptAt: future ? firstAttemptAt({ target: { ...t, mode }, scheduledAt: post.scheduledAt, media, now }) : now }, { audit: 'retry', detail: { by: 'user', from: t.state } });
  emitChanged([t.postId], 'retry');
  wake();
  return null;
}

/** publishing:cancel — one target (FB native: deleted on Facebook first). */
export async function cancel(targetId) {
  const t = getTarget(targetId);
  if (!t) throw plannerError('planner_post_not_found', 'NOT_FOUND');
  if (LOCKED.has(t.state)) throw plannerError('planner_target_locked', 'TARGET_LOCKED');
  if (['published', 'canceled'].includes(t.state)) return null;
  const { steps, followUps } = ops();
  await followUps.withLease(t.id, async (cur) => {
    if (LOCKED.has(cur.state)) throw plannerError('planner_target_locked', 'TARGET_LOCKED');
    if (cur.state === 'handed_off') await followUps.cancelRemote(cur, getPost(cur.postId, { includeDeleted: true }));
    steps.set(cur, { state: 'canceled', nextAttemptAt: null }, { audit: 'canceled', detail: { by: 'user' } });
  });
  steps.settlePost(t.postId);
  emitChanged([t.postId], 'canceled');
  wake();
  return null;
}

/** publishing:resolveMissed — publish now / reschedule / skip for missed targets. */
export async function resolveMissed({ targetIds, action, scheduledAt } = {}, { now = Date.now() } = {}) {
  const targets = (targetIds ?? []).map((id) => getTarget(Number(id))).filter((t) => t?.state === 'missed');
  const postIds = [...new Set(targets.map((t) => t.postId))];
  const { steps, followUps } = ops();
  if (action === 'publish') {
    for (const t of targets) {
      ensureScheduled(requirePost(t.postId), now);
      steps.set(t, { state: 'queued', mode: 'app', attempts: 0, nextAttemptAt: now, lastErrorCode: null, lastError: null }, { audit: 'missed_publish' });
    }
  } else if (action === 'reschedule') {
    if (!Number.isFinite(scheduledAt) || scheduledAt < now - LIMITS.common.pastGraceMs) throw plannerError('planner_time_past', 'TIME_PAST');
    for (const postId of postIds) {
      reschedulePost(postId, scheduledAt, { now });
      await followUps.recompute(postId);
    }
  } else if (action === 'skip') {
    for (const t of targets) steps.set(t, { state: 'canceled', nextAttemptAt: null }, { audit: 'missed_skipped' });
    for (const postId of postIds) steps.settlePost(postId);
  } else {
    throw plannerError('planner_invalid_payload', 'INVALID_PAYLOAD', { field: 'action' });
  }
  if (postIds.length) emitChanged(postIds, 'missed_resolved', { action });
  progressBus.emit('publish:missed', { count: listTargets({ states: ['missed'] }).length });
  wake();
  return null;
}

/** publishing:quota — cached quota; refreshed from Meta when asked or older than 10 min. */
export async function quota({ accountId, refresh = false } = {}, { now = Date.now(), makeContext = createPublishContext } = {}) {
  const account = getAccount(String(accountId));
  if (!account) throw plannerError('planner_account_unknown', 'ACCOUNT_UNKNOWN', { id: accountId });
  const cached = getQuota(account.igId);
  const publisher = getPublisher(account.platform, { demo: isDemoMode() });
  const stale = !cached || cached.checkedAt == null || now - cached.checkedAt > QUOTA_CACHE_MS;
  if (publisher?.quota && account.platform !== 'facebook' && (refresh || stale)) {
    const fresh = await publisher.quota(makeContext(), account);
    const saved = setQuota(account.igId, { ...fresh, checkedAt: now });
    return { used: saved.used, total: saved.total, windowSec: saved.windowSec, checkedAt: saved.checkedAt };
  }
  return cached ? { used: cached.used, total: cached.total, windowSec: cached.windowSec, checkedAt: cached.checkedAt } : { used: null, total: null, windowSec: null, checkedAt: null };
}

export function setPaused(paused) {
  setConfig('planner.paused', paused === true);
  addAudit({ actor: 'user', action: paused === true ? 'publishing_paused' : 'publishing_resumed' });
  wake();
  return null;
}
