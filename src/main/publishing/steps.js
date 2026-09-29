import fsp from 'node:fs/promises';
import path from 'node:path';
import { q } from '../db/index.js';
import {
  updateTarget, addAudit, getPost, listTargets, listUploads, setPostStatus, getQuota, setQuota,
} from '../db/queries/planner.js';
import { derivePostStatus, TERMINAL_TARGET_STATES } from '../planner/status.js';
import { assetFilePath, getMediaRoot } from '../planner/assets.js';
import { formatRule } from './capabilities.js';
import { msg } from '../i18n.js';
import { classify, describeFailure, publishError, backoffMs, MAX_ATTEMPTS, RATE_DELAY_MS, QUOTA_DELAY_MS } from './errors.js';
import { ensureHosted, cleanupUploads } from './hosts/index.js';
import { authOf } from './context.js';
import { firstCommentOf } from './platforms/shared.js';
import {
  POLL_MS, CONTAINER_TIMEOUT_MS, RECOVER_DELAY_MS, UNCERTAIN_WAIT_MS, RECONCILE_WINDOW_MS, QUOTA_CACHE_MS, nextReconcileAt, insideNativeWindow, nativeWindow, HOUR,
} from './timing.js';

/**
 * One worker step per target state (plan §6.7). Every state change is persisted (and audited) BEFORE the network call
 * that follows it, so a crash never loses track of a call that may have reached Meta:
 *   queued → hosting → container → ready → publishing → (commenting →) published
 *   queued (FB native) → container (hand-off in flight) → handed_off → published (reconcile)
 * `publishing` found on a later tick = interrupted publish → recover(): found → published, provably not published →
 * ready (safe retry), inconclusive → failed 'uncertain_publish' (never republished automatically).
 */
export const PENDING_STATES = Object.freeze(['queued', 'hosting', 'container', 'ready', 'handed_off', 'publishing', 'commenting', 'paused']);
const RESUME_STATE = { queued: 'queued', hosting: 'queued', container: 'container', ready: 'ready', publishing: 'ready', handed_off: 'handed_off' };
const APP_PAUSABLE = ['queued', 'hosting', 'container', 'ready'];

const assetName = (asset) => path.basename(asset.storedPath);

/**
 * @param {{ deps: object, emit: Function, emitChanged: Function, notifier: object, pausedAuth: Map<string, string|null> }} env
 */
export function createSteps(env) {
  const { deps, emit, emitChanged, notifier, pausedAuth } = env;
  const now = () => deps.now();

  function set(target, patch, { audit, detail, progress = true } = {}) {
    const next = updateTarget(target.id, patch);
    if (audit) addAudit({ postId: target.postId, targetId: target.id, actor: 'worker', action: audit, detail: detail ?? null, at: now() });
    if (progress && patch.state) emit('publish:progress', { targetId: target.id, postId: target.postId, state: patch.state });
    return next;
  }

  const lastAuditAt = (targetId, action) => q.get('SELECT MAX(at) AS at FROM planner_audit WHERE target_id = ? AND action = ?', targetId, action)?.at ?? null;

  // ---- post status ------------------------------------------------------------------------------------------------
  function toPublishing(post) {
    if (post.status === 'failed' || post.status === 'partial') setPostStatus(post.id, 'scheduled', { actor: 'worker', now: now() });
    const cur = getPost(post.id);
    if (cur?.status === 'scheduled') setPostStatus(post.id, 'publishing', { actor: 'worker', now: now() });
  }

  /** Post status from its targets once they are all settled (published / partial / failed; all canceled → draft). */
  function settlePost(postId) {
    const post = getPost(postId);
    if (!post) return;
    const derived = derivePostStatus(post.targets);
    if (derived) {
      if (post.status === derived) return;
      if (post.status !== 'publishing') toPublishing(post);
      if (getPost(postId)?.status === 'publishing') setPostStatus(postId, derived, { actor: 'worker', now: now() });
      return;
    }
    const pending = post.targets.some((t) => !['canceled', 'idle'].includes(t.state));
    if (!pending && post.targets.length && post.status === 'scheduled') setPostStatus(postId, 'draft', { actor: 'system', now: now(), note: 'all targets canceled' });
  }

  // ---- failures ---------------------------------------------------------------------------------------------------
  function fail(job, c) {
    const t = set(job.target, { state: 'failed', nextAttemptAt: null, lastErrorCode: c.code, lastError: describeFailure(c), fbtraceId: c.fbtraceId ?? null }, { audit: 'failed', detail: { kind: c.kind, code: c.code, fbtraceId: c.fbtraceId ?? null, message: c.message } });
    settlePost(job.post.id);
    notifier.failed({ post: job.post, target: t, account: job.account, message: t.lastError });
    emitChanged([job.post.id], 'failed');
  }

  function pauseAuth(job, c) {
    const auth = authOf(job.target.platform);
    const platforms = auth === 'threads' ? ['threads'] : ['instagram', 'facebook'];
    const affected = listTargets({ states: APP_PAUSABLE }).filter((t) => platforms.includes(t.platform) && t.mode === 'app');
    const ids = new Set([job.target.id, ...affected.map((t) => t.id)]);
    for (const id of ids) {
      const t = id === job.target.id ? job.target : affected.find((x) => x.id === id);
      set(t, { state: 'paused', nextAttemptAt: null, lastErrorCode: c.code, lastError: describeFailure(c), fbtraceId: c.fbtraceId ?? null }, { audit: 'paused', detail: { auth, code: c.code } });
    }
    pausedAuth.set(auth, deps.tokenFingerprint(auth));
    emit('token:warning', { platform: auth, code: c.code, message: c.message });
    notifier.authPaused(auth);
    emitChanged([...new Set([job.post.id, ...affected.map((t) => t.postId)])], 'paused');
  }

  /** Classified error → retry (with backoff), recreate, pause or fail. */
  function handleError(job, err) {
    const c = classify(err);
    const target = job.target;
    const resume = RESUME_STATE[target.state] ?? 'queued';
    const retryPatch = (delay, extra = {}) => ({ state: resume, nextAttemptAt: now() + delay, lastErrorCode: c.code, lastError: describeFailure(c), fbtraceId: c.fbtraceId ?? null, ...extra });
    if (c.kind === 'auth') return pauseAuth(job, c);
    if (c.kind === 'rate') return set(target, retryPatch(RATE_DELAY_MS), { audit: 'retry', detail: { kind: c.kind, code: c.code } });
    if (c.kind === 'quota') {
      notifier.quota({ account: job.account, target });
      return set(target, retryPatch(QUOTA_DELAY_MS), { audit: 'retry', detail: { kind: c.kind, code: c.code } });
    }
    if (c.kind === 'expired') {
      if (lastAuditAt(target.id, 'container_recreated') != null) return fail(job, c);
      return set(target, { state: 'queued', containerId: null, nextAttemptAt: now() }, { audit: 'container_recreated', detail: { code: c.code } });
    }
    if (c.kind === 'transient') {
      const attempts = (target.attempts ?? 0) + 1;
      if (attempts > MAX_ATTEMPTS) return fail(job, c);
      return set(target, retryPatch(backoffMs(attempts), { attempts }), { audit: 'retry', detail: { kind: c.kind, code: c.code, attempt: attempts } });
    }
    return fail(job, c);
  }

  // ---- hosting ----------------------------------------------------------------------------------------------------
  async function hostItem(job, host, item) {
    const variant = job.publisher.imageVariant(item);
    const base = assetName(item.asset);
    const sha = item.asset.sha256;
    if (!variant) return ensureHosted({ host, assetId: item.assetId, name: base, filePath: item.filePath, mime: item.asset.mime, kind: item.asset.kind, ctx: job.ctx, account: job.account, now: now() });
    const name = `${sha}-${variant.variant}.jpg`;
    const outPath = path.join(getMediaRoot(), 'tmp', name);
    const produceFile = async () => {
      if (!deps.convertImage) throw publishError('pub_image_convert_unavailable');
      await fsp.mkdir(path.dirname(outPath), { recursive: true });
      await deps.convertImage({ filePath: item.filePath, outPath, maxWidth: variant.maxWidth, quality: 90 });
      return outPath;
    };
    try {
      return await ensureHosted({ host, assetId: item.assetId, name, variant: variant.variant, produceFile, mime: 'image/jpeg', kind: 'image', ctx: job.ctx, account: job.account, now: now() });
    } finally {
      await fsp.rm(outPath, { force: true }).catch(() => {});
    }
  }

  async function hostMedia(job) {
    const required = job.publisher.hostedItems(job);
    const optional = job.publisher.optionalHosted(job);
    if (!required.length && !optional.length) return;
    let host = null;
    try { host = deps.createHost(); } catch (e) { if (required.length) throw e; return; }
    if (!host && required.length) throw publishError('pub_host_missing');
    for (const item of required) item.url = (await hostItem(job, host, item)).url;
    for (const item of optional) {
      try { if (host) item.url = (await hostItem(job, host, item)).url; } catch (e) { console.warn('[publishing] optional media not hosted:', e?.message ?? e); }
    }
  }

  /** Deletes remote copies once no other pending target needs the asset. */
  async function cleanupHosted(job) {
    let host = null;
    try { host = deps.createHost(); } catch { return; }
    if (!host?.deleteAfterPublish) return;
    const assetIds = [...new Set([...job.media, ...(job.cover ? [job.cover] : [])].map((m) => m.assetId))];
    const pending = PENDING_STATES.filter((s) => s !== 'handed_off');
    const uploads = [];
    for (const assetId of assetIds) {
      const busy = q.get(
        `SELECT 1 FROM planner_post_assets pa JOIN planner_targets t ON t.post_id = pa.post_id JOIN planner_posts p ON p.id = pa.post_id
         WHERE pa.asset_id = ? AND t.id <> ? AND p.deleted_at IS NULL AND t.state IN (${pending.map(() => '?').join(',')}) LIMIT 1`,
        assetId, job.target.id, ...pending,
      );
      if (!busy) uploads.push(...listUploads({ assetId }));
    }
    if (uploads.length) await cleanupUploads({ host, uploads, ctx: job.ctx, now: now() });
  }

  // ---- quota ------------------------------------------------------------------------------------------------------
  /** @returns {Promise<boolean>} true when publishing may proceed */
  async function quotaAllows(job) {
    if (!job.publisher.quota || job.target.platform === 'facebook') return true;
    let cached = getQuota(job.target.accountId);
    if (!cached || cached.checkedAt == null || now() - cached.checkedAt > QUOTA_CACHE_MS) {
      try {
        const fresh = await job.publisher.quota(job.ctx, job.account);
        cached = setQuota(job.target.accountId, { ...fresh, checkedAt: now() });
      } catch (e) {
        console.warn('[publishing] quota check failed:', e?.message ?? e);
        return true; // the publish call itself reports an exhausted quota
      }
    }
    if (cached?.total != null && cached.used != null && cached.used >= cached.total) {
      set(job.target, { nextAttemptAt: now() + QUOTA_DELAY_MS, lastErrorCode: 'quota', lastError: msg('pub_quota_exhausted', { used: cached.used, total: cached.total }) }, { audit: 'retry', detail: { kind: 'quota', used: cached.used, total: cached.total }, progress: false });
      notifier.quota({ account: job.account, target: job.target });
      return false;
    }
    return true;
  }

  // ---- finalize ---------------------------------------------------------------------------------------------------
  async function finalize(job, result, { recovered = false } = {}) {
    const text = firstCommentOf(job);
    const commentable = text && job.publisher.firstComment && !formatRule(job.target.platform, job.target.format)?.noComments && result.remoteId;
    let t = set(job.target, {
      state: commentable ? 'commenting' : 'published', remoteId: result.remoteId ?? null, permalink: result.permalink ?? null, mediaKey: result.mediaKey ?? null,
      publishedAt: now(), nextAttemptAt: commentable ? now() + RECOVER_DELAY_MS : null, lastErrorCode: null, lastError: null, fbtraceId: null,
    }, { audit: 'published', detail: { remoteId: result.remoteId ?? null, permalink: result.permalink ?? null, recovered } });
    if (commentable) {
      try {
        const c = await job.publisher.firstComment(job.ctx, { ...job, target: t }, text);
        t = set(t, { state: 'published', firstCommentId: c.id ?? null, nextAttemptAt: null }, { audit: 'first_comment', detail: { id: c.id ?? null } });
      } catch (e) {
        const c = classify(e);
        t = set(t, { state: 'published', nextAttemptAt: null, lastErrorCode: 'first_comment_failed', lastError: msg('pub_first_comment_failed', { detail: c.message }), fbtraceId: c.fbtraceId ?? null }, { audit: 'first_comment_failed', detail: { code: c.code, message: c.message } });
      }
    }
    await cleanupHosted(job).catch((e) => console.error('[publishing] cleanup failed:', e?.message ?? e));
    settlePost(job.post.id);
    notifier.published({ post: job.post, target: t, account: job.account });
    emitChanged([job.post.id], 'published');
  }

  // ---- state steps ------------------------------------------------------------------------------------------------
  async function prepare(job) {
    const res = await job.publisher.prepare(job.ctx, job);
    const created = res.containerId && res.containerId !== job.target.containerId;
    const delay = res.pending ? POLL_MS : job.publisher.firstPollDelayMs ?? POLL_MS;
    job.target = set(job.target, { state: 'container', containerId: res.containerId ?? null, nextAttemptAt: now() + delay }, created ? { audit: 'container_created', detail: { containerId: res.containerId, pending: !!res.pending } } : {});
  }

  async function handOff(job) {
    const at = job.post.scheduledAt;
    if (at == null) throw publishError('pub_no_time');
    if (!insideNativeWindow(at, now())) {
      if (at < nativeWindow(now()).min) return set(job.target, { mode: 'app', state: 'queued', nextAttemptAt: now() }, { audit: 'native_fallback', detail: { reason: 'too_soon' } });
      return set(job.target, { nextAttemptAt: at - (nativeWindow(now()).max - now()) + HOUR }, { progress: false });
    }
    job.target = set(job.target, { state: 'container', nextAttemptAt: now() + RECOVER_DELAY_MS }, { audit: 'handoff_started' });
    try {
      const res = await job.publisher.scheduleNative(job.ctx, job, at);
      set(job.target, { state: 'handed_off', containerId: res.containerId, nextAttemptAt: nextReconcileAt(at, now()), attempts: 0, lastErrorCode: null, lastError: null }, { audit: 'handed_off', detail: { containerId: res.containerId, at } });
      emitChanged([job.post.id], 'handed_off');
    } catch (e) {
      if (classify(e).network) return fail(job, { kind: 'invalid', code: 'uncertain_handoff', message: msg('pub_uncertain_handoff'), fbtraceId: null });
      job.target = set(job.target, { state: 'queued' }, { progress: false });
      throw e;
    }
  }

  async function stepQueued(job) {
    if (job.publisher.nativeSchedule && job.target.mode === 'native') return handOff(job);
    if (job.publisher.direct) {
      set(job.target, { state: 'ready', nextAttemptAt: Math.max(now(), job.post.scheduledAt ?? now()) });
      return;
    }
    job.target = set(job.target, { state: 'hosting' });
    await hostMedia(job);
    job.target = set(job.target, { state: 'container' });
    await prepare(job);
  }

  async function stepContainer(job) {
    if (job.target.mode === 'native') return fail(job, { kind: 'invalid', code: 'uncertain_handoff', message: msg('pub_uncertain_handoff'), fbtraceId: null });
    const started = lastAuditAt(job.target.id, 'container_created') ?? now();
    if (now() - started > CONTAINER_TIMEOUT_MS) throw publishError('pub_container_timeout', {}, { kind: 'invalid', code: 'container_timeout' });
    if (job.publisher.needsPrepare(job.target)) {
      if (!job.target.containerId) await hostMedia(job);
      return prepare(job);
    }
    const st = await job.publisher.status(job.ctx, job);
    if (st.status === 'FINISHED') return set(job.target, { state: 'ready', nextAttemptAt: Math.max(now(), job.post.scheduledAt ?? now()) }, { audit: 'container_ready' });
    if (st.status === 'IN_PROGRESS') return set(job.target, { nextAttemptAt: now() + POLL_MS }, { progress: false });
    if (st.status === 'ERROR') throw publishError('pub_container_error', { detail: st.message ?? 'ERROR' }, { kind: 'media', code: 'container_error' });
    if (st.status === 'EXPIRED') throw publishError('pub_container_expired', {}, { kind: 'expired', code: 'container_expired' });
    if (st.status === 'PUBLISHED') return stepPublishing(job);
    return set(job.target, { nextAttemptAt: now() + POLL_MS }, { progress: false });
  }

  async function stepReady(job) {
    const at = job.post.scheduledAt ?? now();
    if (at > now()) return set(job.target, { nextAttemptAt: at }, { progress: false });
    if (!(await quotaAllows(job))) return;
    toPublishing(job.post);
    const startedAt = now();
    job.target = set(job.target, { state: 'publishing', nextAttemptAt: startedAt + RECOVER_DELAY_MS }, { audit: 'publishing_started', detail: { at: startedAt, attempt: (job.target.attempts ?? 0) + 1 } });
    let result;
    try {
      result = await job.publisher.publish(job.ctx, job);
    } catch (e) {
      if (classify(e).network) {
        set(job.target, { nextAttemptAt: now() + RECOVER_DELAY_MS, lastErrorCode: 'network', lastError: e?.message ?? 'network' }, { audit: 'publish_uncertain', detail: { message: e?.message ?? null }, progress: false });
        return;
      }
      job.target = set(job.target, { state: 'ready' }, { progress: false }); // Meta answered with an error: nothing was published
      throw e;
    }
    await finalize(job, result);
  }

  async function stepPublishing(job) {
    const since = lastAuditAt(job.target.id, 'publishing_started') ?? now() - HOUR;
    const r = await job.publisher.recover(job.ctx, job, { since });
    if (r?.found) return finalize(job, r.found, { recovered: true });
    if (r?.notPublished) {
      if (r.status === 'EXPIRED') throw publishError('pub_container_expired', {}, { kind: 'expired', code: 'container_expired' });
      if (r.status === 'ERROR') throw publishError('pub_container_error', { detail: 'ERROR' }, { kind: 'media', code: 'container_error' });
      return set(job.target, { state: 'ready', nextAttemptAt: now() }, { audit: 'publish_not_sent' });
    }
    if (now() - since < UNCERTAIN_WAIT_MS) return set(job.target, { nextAttemptAt: now() + POLL_MS * 3 }, { progress: false });
    return fail(job, { kind: 'invalid', code: 'uncertain_publish', message: msg('pub_uncertain'), fbtraceId: null });
  }

  /** Crash while commenting: never send the comment twice. */
  function stepCommenting(job) {
    set(job.target, { state: 'published', nextAttemptAt: null }, { audit: job.target.firstCommentId ? 'first_comment' : 'first_comment_uncertain' });
    settlePost(job.post.id);
    emitChanged([job.post.id], 'published');
  }

  async function stepHandedOff(job) {
    const at = job.post.scheduledAt;
    let r;
    try {
      r = await job.publisher.reconcile(job.ctx, job);
    } catch (e) {
      const c = classify(e);
      if (c.kind === 'invalid' || c.kind === 'permission') return fail(job, c);
      return set(job.target, { nextAttemptAt: now() + HOUR, lastErrorCode: c.code, lastError: c.message }, { progress: false });
    }
    if (r.published) return finalize(job, { remoteId: r.remoteId, permalink: r.permalink, mediaKey: r.mediaKey });
    const next = at != null ? nextReconcileAt(at, now()) : null;
    if (next == null || (at != null && now() > at + RECONCILE_WINDOW_MS)) return fail(job, { kind: 'invalid', code: 'native_not_published', message: msg('pub_native_not_published'), fbtraceId: null });
    return set(job.target, { nextAttemptAt: next }, { progress: false });
  }

  const STEPS = { queued: stepQueued, hosting: stepQueued, container: stepContainer, ready: stepReady, publishing: stepPublishing, commenting: stepCommenting, handed_off: stepHandedOff };

  /** Runs the step for the job's current state; errors are classified and persisted. */
  async function run(job) {
    const step = STEPS[job.target.state];
    if (!step) return;
    try {
      await step(job);
    } catch (e) {
      console.error(`[publishing] target ${job.target.id} (${job.target.state}) failed:`, e?.message ?? e);
      handleError(job, e);
    }
  }

  return { run, set, settlePost, fail, handleError, TERMINAL: TERMINAL_TARGET_STATES };
}

/** Media items of a post for a job (absolute file paths; hosted URLs are filled during the hosting step). */
export function jobMedia(post) {
  const items = post.assets.map((a) => ({ assetId: a.assetId, role: a.role, position: a.position, altText: a.altText, asset: a.asset, filePath: assetFilePath(a.asset), url: null }));
  return {
    media: items.filter((i) => i.role === 'media').sort((a, b) => a.position - b.position),
    cover: items.find((i) => i.role === 'cover') ?? null,
  };
}
