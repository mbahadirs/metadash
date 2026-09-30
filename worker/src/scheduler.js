import { getSharedPublisher, authOf, classify, createFetchGraphClient, GRAPH_BASE, THREADS_BASE } from './shared.js';

/**
 * Worker scheduler: a 20 s tick publishes due items with the shared publishers (src/shared/publish).
 *
 * Item state machine (status / step):
 *   queued (step null) → publishing (container_created → processing → ready → publish_called → commenting) → published
 *                                                                                                       ↘ failed | missed
 * Each step is persisted BEFORE the Graph call that follows it, so a restart resumes: an item found in
 * `publish_called` is recovered through publisher.recover() (IG/Threads re-poll the container: PUBLISHED → find the
 * post, never re-publish); inconclusive for UNCERTAIN_WAIT_MS → failed 'uncertain_publish'.
 * Errors: transient/rate/quota back off 1, 2, 5, 10, 30 min (6 attempts); expired containers are recreated once;
 * auth/permission/media/invalid → failed. Items whose publish call has not happened more than maxLateMinutes after
 * their time become `missed` (never published silently late).
 */
export const TICK_MS = 20_000;
export const POLL_MS = 20_000;
export const BACKOFF_MIN = Object.freeze([1, 2, 5, 10, 30]);
export const MAX_ATTEMPTS = 6;
export const RATE_DELAY_MS = 15 * 60_000;
export const QUOTA_DELAY_MS = 30 * 60_000;
export const CONTAINER_TIMEOUT_MS = 60 * 60_000;
export const UNCERTAIN_WAIT_MS = 15 * 60_000;
export const RECOVER_DELAY_MS = 60_000;
export const LEAD_IMAGE_MS = 5 * 60_000;
export const LEAD_VIDEO_MS = 20 * 60_000;
export const DEFAULT_MAX_LATE_MIN = 360;
export const PRUNE_DONE_MS = 30 * 86_400_000;

const PRE_PUBLISH_STEPS = new Set([null, undefined, 'container_created', 'processing', 'ready']);
const ACTIVE = new Set(['queued', 'publishing']);

export const backoffMs = (attempt) => BACKOFF_MIN[Math.min(Math.max(1, attempt), BACKOFF_MIN.length) - 1] * 60_000;

/** When preparation may start: the time for direct publishers, earlier for container platforms (video longer). */
export function firstAttemptAt(item) {
  const publisher = getSharedPublisher(item.platform);
  if (!publisher || publisher.direct) return item.dueAt;
  const video = (item.payload?.media ?? []).some((m) => m.kind === 'video');
  return item.dueAt - (video ? LEAD_VIDEO_MS : LEAD_IMAGE_MS);
}

/**
 * @param {{ store: object, tokens: object, media: object, fetchImpl?: typeof fetch, now?: () => number, log: object,
 *   onChange?: (item: object) => void }} deps
 */
export function createScheduler({ store, tokens, media, fetchImpl = globalThis.fetch, now = Date.now, log, onChange = () => {} }) {
  const meta = createFetchGraphClient({ base: GRAPH_BASE, name: 'meta', fetchImpl });
  const threads = createFetchGraphClient({ base: THREADS_BASE, name: 'threads', fetchImpl });
  let timer = null;
  let running = null;
  let lastRefresh = 0;

  const save = (item, patch) => {
    const next = store.putItem({ ...item, ...patch });
    onChange(next);
    return next;
  };

  // ---- job -----------------------------------------------------------------------------------------------------
  function mediaItem(ref) {
    if (!ref) return null;
    const filePath = ref.sha256 && media.has(ref.sha256) ? media.pathOf(ref.sha256) : null;
    const url = ref.url ?? (ref.sha256 && media.has(ref.sha256) ? media.signedUrl(ref.sha256) : null);
    return {
      assetId: ref.assetId ?? ref.sha256 ?? null, altText: ref.altText ?? null, filePath, url,
      asset: { kind: ref.kind, mime: ref.mime ?? null, bytes: ref.bytes ?? null, fileName: ref.fileName ?? null, format: ref.format ?? null, width: ref.width ?? null },
    };
  }

  function buildJob(item) {
    const p = item.payload;
    const target = {
      id: item.id, accountId: item.accountId, platform: item.platform, format: p.format, captionOverride: null, firstCommentOverride: null,
      options: p.options ?? {}, mode: 'app', containerId: item.containerId ?? null, remoteId: item.remoteId ?? null,
    };
    const ctx = {
      meta, threads, now,
      tokenFor: () => tokens.tokenFor(item.tokenKey),
      pageToken: async () => tokens.tokenFor(item.tokenKey), // the desktop sends the Page token for Facebook items
    };
    return {
      target, ctx, publisher: getSharedPublisher(item.platform),
      post: { id: item.id, caption: p.caption ?? '', firstComment: p.firstComment ?? null, scheduledAt: item.dueAt },
      account: { externalId: p.externalId, igId: item.accountId },
      media: (p.media ?? []).map(mediaItem), cover: mediaItem(p.cover),
    };
  }

  // ---- outcomes ------------------------------------------------------------------------------------------------
  function fail(item, c) {
    if (c.kind === 'auth') tokens.markInvalid(item.tokenKey);
    log.warn('item failed', { id: item.id, platform: item.platform, code: c.code });
    return save(item, { status: 'failed', nextAttemptAt: null, completedAt: now(), lastError: { code: c.code, message: c.key ?? c.message, transient: false } });
  }

  function handleError(item, err) {
    const c = classify(err);
    const lastError = { code: c.code, message: c.key ?? c.message, transient: c.retryable };
    const resumeStep = item.step === 'publish_called' ? 'ready' : item.step;
    if (c.kind === 'rate') return save(item, { step: resumeStep, nextAttemptAt: now() + RATE_DELAY_MS, lastError });
    if (c.kind === 'quota') return save(item, { step: resumeStep, nextAttemptAt: now() + QUOTA_DELAY_MS, lastError });
    if (c.kind === 'transient') {
      const attempts = (item.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) return fail({ ...item, attempts }, c);
      return save(item, { step: resumeStep, attempts, nextAttemptAt: now() + backoffMs(attempts), lastError });
    }
    if (c.kind === 'expired' && !item.recreated) {
      return save(item, { step: null, containerId: null, recreated: true, nextAttemptAt: now(), lastError });
    }
    return fail(item, c);
  }

  async function finalize(item, job, result) {
    const done = { remoteId: result.remoteId ?? null, permalink: result.permalink ?? null, mediaKey: result.mediaKey ?? null, publishedAt: now(), lastError: null };
    const text = item.payload.firstComment;
    let cur = item;
    if (text && result.remoteId && job.publisher.firstComment) {
      cur = save(cur, { ...done, step: 'commenting' });
      try {
        await job.publisher.firstComment(job.ctx, { ...job, target: { ...job.target, remoteId: result.remoteId } }, text);
      } catch (e) {
        const c = classify(e);
        cur = { ...cur, lastError: { code: 'first_comment_failed', message: c.message, transient: false } };
      }
    }
    for (const ref of [...(item.payload.media ?? []), item.payload.cover].filter(Boolean)) if (ref.sha256) media.touch(ref.sha256);
    log.info('item published', { id: item.id, platform: item.platform });
    return save(cur, { ...done, lastError: cur.lastError ?? null, status: 'published', step: null, nextAttemptAt: null, completedAt: now() });
  }

  // ---- steps ---------------------------------------------------------------------------------------------------
  async function prepare(item, job) {
    const res = await job.publisher.prepare(job.ctx, job);
    const delay = res.pending ? POLL_MS : job.publisher.firstPollDelayMs ?? POLL_MS;
    return save(item, { status: 'publishing', step: 'container_created', containerId: res.containerId ?? null, containerAt: item.containerAt ?? now(), nextAttemptAt: now() + delay });
  }

  async function stepContainer(item, job) {
    if (now() - (item.containerAt ?? now()) > CONTAINER_TIMEOUT_MS) {
      return fail(item, { kind: 'invalid', code: 'container_timeout', key: 'pub_container_timeout', message: 'container timeout' });
    }
    if (job.publisher.needsPrepare(job.target)) return prepare(item, job);
    const st = await job.publisher.status(job.ctx, job);
    if (st.status === 'FINISHED') return save(item, { step: 'ready', nextAttemptAt: Math.max(now(), item.dueAt) });
    if (st.status === 'ERROR') return fail(item, { kind: 'media', code: 'container_error', key: 'pub_container_error', message: st.message ?? 'ERROR' });
    if (st.status === 'EXPIRED') return handleError(item, { name: 'PublishError', kind: 'expired', code: 'container_expired', key: 'pub_container_expired', message: 'expired' });
    if (st.status === 'PUBLISHED') return stepRecover(save(item, { step: 'publish_called', startedAt: item.startedAt ?? item.containerAt ?? now() }), job);
    return save(item, { step: 'processing', nextAttemptAt: now() + POLL_MS });
  }

  async function quotaAllows(item, job) {
    if (!job.publisher.quota || item.platform === 'facebook') return true;
    try {
      const q = await job.publisher.quota(job.ctx, job.account);
      if (q?.total != null && q.used != null && q.used >= q.total) {
        save(item, { nextAttemptAt: now() + QUOTA_DELAY_MS, lastError: { code: 'quota', message: 'pub_quota_exhausted', transient: true } });
        return false;
      }
    } catch (e) {
      log.warn('quota check failed', { id: item.id, code: e?.code ?? null });
    }
    return true;
  }

  async function stepReady(item, job) {
    if (item.dueAt > now()) return save(item, { status: 'publishing', step: 'ready', nextAttemptAt: item.dueAt });
    if (!(await quotaAllows(item, job))) return null;
    const cur = save(item, { status: 'publishing', step: 'publish_called', startedAt: now(), nextAttemptAt: now() + RECOVER_DELAY_MS });
    let result;
    try {
      result = await job.publisher.publish(job.ctx, job);
    } catch (e) {
      if (classify(e).network) return save(cur, { nextAttemptAt: now() + RECOVER_DELAY_MS, lastError: { code: 'network', message: 'network', transient: true } });
      return handleError(cur, e); // Meta answered with an error: nothing was published
    }
    return finalize(cur, job, result);
  }

  async function stepRecover(item, job) {
    const since = item.startedAt ?? now();
    const r = job.publisher.recover ? await job.publisher.recover(job.ctx, job, { since }) : null;
    if (r?.found) return finalize(item, job, r.found);
    if (r?.notPublished) {
      if (r.status === 'EXPIRED' || r.status === 'ERROR') return handleError(item, { name: 'PublishError', kind: r.status === 'EXPIRED' ? 'expired' : 'media', code: `container_${r.status.toLowerCase()}`, message: r.status });
      return save(item, { step: 'ready', nextAttemptAt: now() });
    }
    if (now() - since < UNCERTAIN_WAIT_MS) return save(item, { nextAttemptAt: now() + POLL_MS * 3 });
    return fail(item, { kind: 'invalid', code: 'uncertain_publish', key: 'pub_uncertain', message: 'uncertain publish' });
  }

  async function step(item) {
    const job = buildJob(item);
    if (!job.publisher) return fail(item, { kind: 'config', code: 'unsupported_platform', message: item.platform });
    try {
      if (item.step === 'commenting') return save(item, { status: 'published', step: null, nextAttemptAt: null, completedAt: now() });
      if (item.step === 'publish_called') return await stepRecover(item, job);
      if (item.step === 'ready' || (job.publisher.direct && !item.step)) return await stepReady(item, job);
      if (!item.step) return await prepare(item, job);
      return await stepContainer(item, job); // container_created | processing (children refs are re-prepared there)
    } catch (e) {
      return handleError(item, e);
    }
  }

  // ---- tick ----------------------------------------------------------------------------------------------------
  function detectMissed() {
    let n = 0;
    for (const item of store.listItems()) {
      if (!ACTIVE.has(item.status) || !PRE_PUBLISH_STEPS.has(item.step ?? null)) continue;
      const maxLate = (Number(item.policy?.maxLateMinutes) || DEFAULT_MAX_LATE_MIN) * 60_000;
      if (now() <= item.dueAt + maxLate) continue;
      save(item, { status: 'missed', step: null, nextAttemptAt: null, completedAt: now(), lastError: { code: 'missed', message: 'pub_missed', transient: false } });
      n += 1;
    }
    return n;
  }

  async function prune() {
    const keep = new Set();
    for (const item of store.listItems()) {
      const done = !ACTIVE.has(item.status);
      if (done && item.completedAt != null && now() - item.completedAt > PRUNE_DONE_MS) { store.deleteItem(item.id); continue; }
      if (!done) for (const ref of [...(item.payload?.media ?? []), item.payload?.cover].filter(Boolean)) if (ref.sha256) keep.add(ref.sha256);
    }
    await media.prune(keep);
  }

  async function runOnce() {
    detectMissed();
    const due = store.listItems().filter((i) => ACTIVE.has(i.status) && i.nextAttemptAt != null && i.nextAttemptAt <= now()).sort((a, b) => a.nextAttemptAt - b.nextAttemptAt);
    for (const item of due) {
      const fresh = store.getItem(item.id);
      if (!fresh || !ACTIVE.has(fresh.status) || fresh.revision !== item.revision) continue;
      await step(fresh);
    }
    if (now() - lastRefresh > 3_600_000) {
      lastRefresh = now();
      await tokens.refreshThreads().catch((e) => log.warn('token refresh failed', { code: e?.code ?? null }));
      await prune().catch((e) => log.warn('prune failed', { code: e?.code ?? null }));
    }
  }

  /** One pass; concurrent calls share the running pass. */
  function tick() {
    if (!running) running = runOnce().catch((e) => log.error('tick failed', { message: e?.message })).finally(() => { running = null; });
    return running;
  }

  return {
    tick,
    step,
    detectMissed,
    prune,
    authOf,
    start(intervalMs = TICK_MS) {
      if (timer) return;
      timer = setInterval(() => { tick(); }, intervalMs);
      timer.unref?.();
      tick();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await running;
    },
  };
}
