import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createWorker } from '../src/main/publishing/worker.js';
import { classify, backoffMs, PublishError } from '../src/main/publishing/errors.js';
import { leadFor, firstAttemptAt, nextReconcileAt, LEAD_IMAGE_MS, LEAD_VIDEO_MS } from '../src/main/publishing/timing.js';
import { getPublisher } from '../src/main/publishing/platforms/index.js';
import { MetaError, NetworkError } from '../src/main/meta/errors.js';
import { q } from '../src/main/db/index.js';
import { getPost, getTarget, updateTarget, leaseTarget, listAudit, setQuota } from '../src/main/db/queries/planner.js';
import { setConfig } from '../src/main/config/store.js';
import { schedule, unschedule, retry, resolveMissed, cancel } from '../src/main/publishing/actions.js';
import { setupPublishingDb, ACCOUNTS } from './fixtures/graph/publish.js';

const MIN = 60_000;
const T = Date.UTC(2026, 9, 1, 12, 0);
let db;
let clock;
let events;
let notes;
let fp;

beforeAll(() => { db = setupPublishingDb('metadash-worker-'); });
afterAll(() => db.cleanup());
beforeEach(() => {
  q.run('DELETE FROM planner_targets');
  q.run('DELETE FROM planner_post_assets');
  q.run('DELETE FROM planner_audit');
  q.run('DELETE FROM planner_posts');
  q.run('DELETE FROM planner_quota');
  clock = { t: T - 5 * MIN };
  events = [];
  notes = [];
  fp = { meta: 'fp1', threads: 'fpT' };
  for (const [k, v] of Object.entries({ 'planner.paused': false, 'planner.missedPolicy': 'ask', 'planner.missedGraceMin': 15, 'planner.maxLateMin': 180, 'planner.requireApproval': false })) setConfig(k, v);
});

function fakePublisher(overrides = {}) {
  const calls = [];
  const rec = (name, fn) => async (...args) => { calls.push(name); return fn(...args); };
  const pub = {
    platform: 'instagram', nativeSchedule: false, direct: false, firstPollDelayMs: 0,
    imageVariant: () => null, hostedItems: () => [], optionalHosted: () => [],
    needsPrepare: (t) => !t.containerId,
    prepare: async () => ({ containerId: 'C1' }),
    status: async () => ({ status: 'FINISHED', message: null }),
    publish: async () => ({ remoteId: 'R1', permalink: 'https://x/p/R1', mediaKey: 'R1' }),
    recover: async () => ({ notPublished: true }),
    firstComment: async () => ({ id: 'FC1' }),
    quota: async () => ({ used: 1, total: 100, windowSec: 86400 }),
    ...overrides,
  };
  for (const k of ['prepare', 'status', 'publish', 'recover', 'firstComment', 'quota', 'scheduleNative', 'reconcile', 'reschedule', 'cancelNative']) if (pub[k]) pub[k] = rec(k, pub[k]);
  return Object.assign(pub, { calls });
}

const notifier = () => new Proxy({}, { get: (_, name) => (arg) => { notes.push([name, arg]); return Promise.resolve(true); } });

function makeWorker({ publishers = {}, demo = false, owner = 'owner-A' } = {}) {
  return createWorker({
    now: () => clock.t,
    setTimer: () => 0,
    clearTimer: () => {},
    emit: (evt, p) => events.push([evt, p]),
    on: null,
    getPublisher: (platform, opts) => (demo ? getPublisher(platform, opts) : publishers[platform] ?? null),
    createHost: () => null,
    makeContext: () => ({ now: () => clock.t, latestMedia: () => ({ permalink: 'https://demo/p/1' }) }),
    notifier: notifier(),
    isDemo: () => demo,
    tokenFingerprint: (auth) => fp[auth],
    owner,
  });
}

async function run(w, times = 1) {
  for (let i = 0; i < times; i += 1) {
    await w.tick();
    await w.idle();
  }
}

function scheduledPost({ platform = 'instagram', accountId = ACCOUNTS.ig, format = 'image', at = T, firstComment = null, mode = 'app', assets } = {}) {
  const media = assets ?? (format === 'text' ? [] : [db.makeAsset()]);
  const id = db.makePost({ status: 'scheduled', scheduledAt: at, firstComment, targets: [{ accountId, platform, format, mode }], assets: media });
  const post = getPost(id);
  const t = post.targets[0];
  updateTarget(t.id, { state: 'queued', nextAttemptAt: firstAttemptAt({ target: t, scheduledAt: at, media, now: clock.t }) });
  return { postId: id, targetId: t.id };
}

describe('errors.classify', () => {
  it('maps Graph codes to classes', () => {
    expect(classify(new MetaError({ code: 190 })).kind).toBe('auth');
    expect(classify(new MetaError({ code: 10 })).kind).toBe('permission');
    expect(classify(new MetaError({ code: 200 })).kind).toBe('permission');
    expect(classify(new MetaError({ code: 4 })).kind).toBe('rate');
    expect(classify(new MetaError({ code: 80002 })).kind).toBe('rate');
    expect(classify(new MetaError({ code: 9, subcode: 2207042 })).kind).toBe('quota');
    expect(classify(new MetaError({ code: 36003, subcode: 2207026 })).kind).toBe('media');
    expect(classify(new MetaError({ code: 2 })).kind).toBe('transient');
    expect(classify(new MetaError({ code: 500, status: 500 })).kind).toBe('transient');
    expect(classify(new MetaError({ code: 100, fbtraceId: 'TR' }))).toMatchObject({ kind: 'invalid', code: '100', fbtraceId: 'TR' });
    expect(classify(new NetworkError('timeout'))).toMatchObject({ kind: 'transient', network: true });
    expect(classify(new PublishError('pub_host_missing'))).toMatchObject({ kind: 'config', code: 'pub_host_missing', retryable: false });
    expect([1, 2, 3, 4, 5].map((n) => backoffMs(n) / MIN)).toEqual([1, 5, 15, 60, 180]);
  });
});

describe('timing', () => {
  it('lead times: IG video 30 min, images 5 min, text / FB 0; native = now', () => {
    expect(leadFor({ platform: 'instagram', format: 'reel' }, [{ kind: 'video' }])).toBe(LEAD_VIDEO_MS);
    expect(leadFor({ platform: 'instagram', format: 'carousel' }, [{ kind: 'image' }, { kind: 'video' }])).toBe(LEAD_VIDEO_MS);
    expect(leadFor({ platform: 'threads', format: 'image' }, [{ kind: 'image' }])).toBe(LEAD_IMAGE_MS);
    expect(leadFor({ platform: 'threads', format: 'text' }, [])).toBe(0);
    expect(leadFor({ platform: 'facebook', format: 'video' }, [{ kind: 'video' }])).toBe(0);
    expect(firstAttemptAt({ target: { platform: 'facebook', format: 'photo', mode: 'native' }, scheduledAt: T, media: [], now: 5 })).toBe(5);
    expect(nextReconcileAt(T, T)).toBe(T + 5 * MIN);
    expect(nextReconcileAt(T, T + 6 * MIN)).toBe(T + 30 * MIN);
    expect(nextReconcileAt(T, T + 25 * 60 * MIN)).toBeNull();
  });
});

describe('worker', () => {
  it('queued → container → ready → published at T, with first comment, audit and notification', async () => {
    const ig = fakePublisher();
    const w = makeWorker({ publishers: { instagram: ig } });
    const { postId, targetId } = scheduledPost({ firstComment: 'first!' });
    await run(w);
    expect(getTarget(targetId)).toMatchObject({ state: 'container', containerId: 'C1' });
    await run(w);
    expect(getTarget(targetId)).toMatchObject({ state: 'ready', nextAttemptAt: T });
    await run(w);
    expect(ig.calls).not.toContain('publish'); // not yet T
    clock.t = T;
    await run(w);
    expect(getTarget(targetId)).toMatchObject({ state: 'published', remoteId: 'R1', mediaKey: 'R1', firstCommentId: 'FC1', publishedAt: T });
    expect(getPost(postId).status).toBe('published');
    expect(ig.calls.filter((c) => c === 'publish')).toHaveLength(1);
    const actions = listAudit({ postId }).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['container_created', 'container_ready', 'publishing_started', 'published', 'first_comment']));
    expect(notes.find(([n]) => n === 'published')).toBeTruthy();
    expect(events.some(([e, p]) => e === 'publish:progress' && p.state === 'published')).toBe(true);
    expect(events.some(([e, p]) => e === 'planner:changed' && p.source === 'worker')).toBe(true);
  });

  it('a lease held by another live owner blocks the target; a stale lease does not', async () => {
    const ig = fakePublisher();
    const w = makeWorker({ publishers: { instagram: ig } });
    const { targetId } = scheduledPost();
    expect(leaseTarget(targetId, 'other', clock.t)).toBe(true);
    await run(w);
    expect(ig.calls).toEqual([]);
    clock.t += 11 * MIN; // lease is stale after 10 min
    await run(w);
    expect(ig.calls).toContain('prepare');
  });

  it('transient errors back off 1/5/15/60/180 min, then fail', async () => {
    const ig = fakePublisher({ prepare: async () => { throw new MetaError({ code: 2, message: 'Service temporarily unavailable' }); } });
    const w = makeWorker({ publishers: { instagram: ig } });
    const { targetId } = scheduledPost({ at: T + 24 * 60 * MIN });
    clock.t = getTarget(targetId).nextAttemptAt;
    const delays = [];
    for (let i = 0; i < 5; i += 1) {
      await run(w);
      const t = getTarget(targetId);
      delays.push((t.nextAttemptAt - clock.t) / MIN);
      expect(t).toMatchObject({ state: 'container', containerId: null, attempts: i + 1 }); // resumes at the failed step
      clock.t = t.nextAttemptAt;
    }
    expect(delays).toEqual([1, 5, 15, 60, 180]);
    await run(w);
    expect(getTarget(targetId)).toMatchObject({ state: 'failed', lastErrorCode: '2' });
  });

  it('non-retryable errors fail at once and keep the fbtrace id', async () => {
    const ig = fakePublisher({ prepare: async () => { throw new MetaError({ code: 100, message: 'Invalid parameter', fbtraceId: 'TRACE9', userMessage: 'The image aspect ratio is not supported.' }); } });
    const w = makeWorker({ publishers: { instagram: ig } });
    const { postId, targetId } = scheduledPost();
    await run(w);
    expect(getTarget(targetId)).toMatchObject({ state: 'failed', lastErrorCode: '100', fbtraceId: 'TRACE9', lastError: 'The image aspect ratio is not supported.' });
    expect(getPost(postId).status).toBe('failed');
    expect(notes.find(([n]) => n === 'failed')).toBeTruthy();
  });

  it('network drop during publish → recover finds the post (no duplicate)', async () => {
    let first = true;
    const ig = fakePublisher({
      publish: async () => { if (first) { first = false; throw new NetworkError('timeout'); } return { remoteId: 'DUP' }; },
      recover: async () => ({ found: { remoteId: 'R7', permalink: 'https://x/p/R7', mediaKey: 'R7' } }),
    });
    const w = makeWorker({ publishers: { instagram: ig } });
    const { targetId } = scheduledPost();
    clock.t = T;
    await run(w, 3);
    expect(getTarget(targetId).state).toBe('publishing');
    clock.t += 3 * MIN;
    await run(w);
    expect(getTarget(targetId)).toMatchObject({ state: 'published', remoteId: 'R7' });
    expect(ig.calls.filter((c) => c === 'publish')).toHaveLength(1);
  });

  it('inconclusive recovery waits, then fails as uncertain_publish without republishing', async () => {
    const ig = fakePublisher({ publish: async () => { throw new NetworkError('reset'); }, recover: async () => null });
    const w = makeWorker({ publishers: { instagram: ig } });
    const { targetId } = scheduledPost();
    clock.t = T;
    await run(w, 3);
    clock.t += 3 * MIN;
    await run(w);
    expect(getTarget(targetId).state).toBe('publishing');
    clock.t += 5 * MIN;
    await run(w);
    expect(getTarget(targetId)).toMatchObject({ state: 'failed', lastErrorCode: 'uncertain_publish' });
    expect(ig.calls.filter((c) => c === 'publish')).toHaveLength(1);
  });

  it('provably unpublished after a crash → safe retry of the publish call', async () => {
    const ig = fakePublisher({ recover: async () => ({ notPublished: true }) });
    const w = makeWorker({ publishers: { instagram: ig } });
    const { targetId } = scheduledPost();
    updateTarget(targetId, { state: 'publishing', containerId: 'C1', nextAttemptAt: T });
    clock.t = T;
    await run(w);
    expect(getTarget(targetId).state).toBe('ready');
    await run(w);
    expect(getTarget(targetId).state).toBe('published');
  });

  it('missed policy ask → missed + publish:missed + notification', async () => {
    const w = makeWorker({ publishers: { instagram: fakePublisher() } });
    const { postId, targetId } = scheduledPost();
    clock.t = T + 30 * MIN;
    await run(w);
    expect(getTarget(targetId)).toMatchObject({ state: 'missed', lastErrorCode: 'missed' });
    expect(events.find(([e]) => e === 'publish:missed')?.[1]).toEqual({ count: 1 });
    expect(notes.find(([n]) => n === 'missed')?.[1]).toBe(1);
    expect(getPost(postId).status).toBe('failed');
    // resolve: publish now
    await resolveMissed({ targetIds: [targetId], action: 'publish' }, { now: clock.t });
    await run(w, 3);
    expect(getTarget(targetId).state).toBe('published');
  });

  it('missed policy publish respects maxLateMin; skip never publishes', async () => {
    setConfig('planner.missedPolicy', 'publish');
    const ig = fakePublisher();
    const w = makeWorker({ publishers: { instagram: ig } });
    const a = scheduledPost();
    clock.t = T + 60 * MIN;
    await run(w, 3);
    expect(getTarget(a.targetId).state).toBe('published');
    const b = scheduledPost({ at: T + 60 * MIN - 200 * MIN });
    await run(w);
    expect(getTarget(b.targetId).state).toBe('missed');
    setConfig('planner.missedPolicy', 'skip');
    const c = scheduledPost({ at: T });
    await run(w);
    expect(getTarget(c.targetId).state).toBe('missed');
    expect(events.filter(([e]) => e === 'publish:missed')).toHaveLength(0);
  });

  it('auth error pauses only that auth (Meta), emits token:warning; resumes after the token changes', async () => {
    const ig = fakePublisher({ prepare: async () => { throw new MetaError({ code: 190, message: 'Session expired' }); } });
    const th = fakePublisher({ platform: 'threads' });
    const w = makeWorker({ publishers: { instagram: ig, threads: th } });
    const a = scheduledPost();
    const b = scheduledPost({ at: T + 60 * MIN });
    const c = scheduledPost({ platform: 'threads', accountId: ACCOUNTS.th, format: 'text', at: T + 60 * MIN });
    await run(w);
    expect(getTarget(a.targetId).state).toBe('paused');
    expect(getTarget(b.targetId).state).toBe('paused');
    expect(getTarget(c.targetId).state).toBe('queued');
    expect(events.filter(([e]) => e === 'token:warning').map(([, p]) => p.platform)).toEqual(['meta']);
    expect(notes.filter(([n]) => n === 'authPaused')).toHaveLength(1);
    await run(w);
    expect(getTarget(a.targetId).state).toBe('paused'); // same token → stays paused
    fp.meta = 'fp2';
    ig.prepare = async () => ({ containerId: 'C9' });
    await run(w);
    expect(getTarget(a.targetId).state).not.toBe('paused');
  });

  it('planner.paused stops new steps', async () => {
    setConfig('planner.paused', true);
    const ig = fakePublisher();
    const w = makeWorker({ publishers: { instagram: ig } });
    scheduledPost();
    await run(w);
    expect(ig.calls).toEqual([]);
    expect(w.status().paused).toBe(true);
    setConfig('planner.paused', false);
  });

  it('EXPIRED container is recreated once, then the target fails', async () => {
    const ig = fakePublisher({ status: async () => ({ status: 'EXPIRED' }) });
    const w = makeWorker({ publishers: { instagram: ig } });
    const { targetId } = scheduledPost();
    await run(w, 2);
    expect(getTarget(targetId)).toMatchObject({ state: 'queued', containerId: null });
    await run(w, 2);
    expect(getTarget(targetId)).toMatchObject({ state: 'failed', lastErrorCode: 'container_expired' });
  });

  it('exhausted quota defers the publish and warns once', async () => {
    const ig = fakePublisher();
    const w = makeWorker({ publishers: { instagram: ig } });
    const { targetId } = scheduledPost();
    setQuota(ACCOUNTS.ig, { used: 100, total: 100, windowSec: 86400, checkedAt: T });
    clock.t = T;
    await run(w, 3);
    expect(getTarget(targetId)).toMatchObject({ state: 'ready', lastErrorCode: 'quota', nextAttemptAt: T + 30 * MIN });
    expect(notes.filter(([n]) => n === 'quota')).toHaveLength(1);
  });

  it('demo mode publishes with the simulated publisher (app mode + FB native reconcile)', async () => {
    const w = makeWorker({ demo: true });
    const ig = scheduledPost();
    const fb = scheduledPost({ platform: 'facebook', accountId: ACCOUNTS.fb, format: 'photo', mode: 'native', at: T + 60 * MIN });
    await run(w);
    expect(getTarget(fb.targetId)).toMatchObject({ state: 'handed_off', containerId: `demo_fb_${fb.targetId}` });
    clock.t += 5000;
    await run(w, 2);
    clock.t = T;
    await run(w, 2);
    expect(getTarget(ig.targetId)).toMatchObject({ state: 'published', permalink: 'https://demo/p/1' });
    clock.t = T + 65 * MIN;
    await run(w);
    expect(getTarget(fb.targetId).state).toBe('published');
  });

  it('follow-ups: reschedule recomputes next_attempt_at; deleting a handed-off post cancels it remotely', async () => {
    const fbPub = fakePublisher({ platform: 'facebook', nativeSchedule: true, direct: true, scheduleNative: async () => ({ containerId: 'FBPOST1' }), cancelNative: async () => {}, reschedule: async () => {}, reconcile: async () => ({ published: false }) });
    const ig = fakePublisher();
    const w = makeWorker({ publishers: { instagram: ig, facebook: fbPub } });
    const a = scheduledPost({ at: T + 120 * MIN });
    q.run('UPDATE planner_posts SET scheduled_at = ? WHERE id = ?', T + 240 * MIN, a.postId);
    await w.handleChanged({ postIds: [a.postId], reason: 'rescheduled' });
    await w.idle();
    expect(getTarget(a.targetId).nextAttemptAt).toBe(T + 240 * MIN - LEAD_IMAGE_MS);
    const b = scheduledPost({ platform: 'facebook', accountId: ACCOUNTS.fb, format: 'photo', mode: 'native', at: T + 120 * MIN });
    await run(w);
    expect(getTarget(b.targetId).state).toBe('handed_off');
    q.run('UPDATE planner_posts SET scheduled_at = ? WHERE id = ?', T + 180 * MIN, b.postId);
    await w.handleChanged({ postIds: [b.postId], reason: 'rescheduled' });
    await w.idle();
    expect(fbPub.calls).toContain('reschedule');
    q.run('UPDATE planner_posts SET deleted_at = ? WHERE id = ?', clock.t, b.postId);
    await w.handleChanged({ postIds: [b.postId], reason: 'deleted', handedOffTargetIds: [b.targetId], cancelRemote: true });
    await w.idle();
    expect(fbPub.calls).toContain('cancelNative');
    expect(getTarget(b.targetId).state).toBe('canceled');
  });

  it('start(): releases foreign leases and gives handed-off targets without a reconcile time one', () => {
    const w = makeWorker({ publishers: {} });
    const a = scheduledPost({ platform: 'facebook', accountId: ACCOUNTS.fb, format: 'photo', mode: 'native', at: T + 60 * MIN });
    updateTarget(a.targetId, { state: 'handed_off', containerId: 'demo_fb_1', nextAttemptAt: null, lockedAt: clock.t, lockOwner: 'dead-process' });
    w.start();
    w.stop();
    expect(getTarget(a.targetId)).toMatchObject({ nextAttemptAt: T + 65 * MIN, lockOwner: null });
  });

  it('edited content on a handed-off post: cancel remotely and hand off again', async () => {
    let n = 0;
    const fbPub = fakePublisher({ platform: 'facebook', nativeSchedule: true, direct: true, scheduleNative: async () => ({ containerId: `FB${++n}` }), cancelNative: async () => {}, reconcile: async () => ({ published: false }) });
    const w = makeWorker({ publishers: { facebook: fbPub } });
    const b = scheduledPost({ platform: 'facebook', accountId: ACCOUNTS.fb, format: 'photo', mode: 'native', at: T + 120 * MIN });
    await run(w);
    await w.handleChanged({ postIds: [b.postId], reason: 'edited', remoteCancelTargetIds: [b.targetId] });
    await w.idle();
    expect(getTarget(b.targetId)).toMatchObject({ state: 'queued', containerId: null });
    await run(w);
    expect(getTarget(b.targetId)).toMatchObject({ state: 'handed_off', containerId: 'FB2' });
  });
});

describe('publishing actions', () => {
  it('schedule queues targets with lead times; approval and validation are enforced; unschedule returns to draft', async () => {
    clock.t = T - 60 * MIN;
    const asset = db.makeAsset();
    const id = db.makePost({ scheduledAt: T, targets: [{ accountId: ACCOUNTS.th, platform: 'threads', format: 'text' }] });
    const res = schedule(id, { now: clock.t });
    expect(res).toMatchObject({ queued: 1, handedOff: 0 });
    expect(getPost(id).status).toBe('scheduled');
    expect(getPost(id).targets[0]).toMatchObject({ state: 'queued', nextAttemptAt: T });
    await unschedule(id);
    expect(getPost(id).status).toBe('draft');
    expect(getPost(id).targets[0]).toMatchObject({ state: 'idle', nextAttemptAt: null });

    setConfig('planner.requireApproval', true);
    expect(() => schedule(id, { now: clock.t })).toThrow(expect.objectContaining({ code: 'APPROVAL_REQUIRED' }));
    setConfig('planner.requireApproval', false);

    const bad = db.makePost({ scheduledAt: T, targets: [{ accountId: ACCOUNTS.ig, platform: 'instagram', format: 'carousel' }], assets: [asset] });
    expect(() => schedule(bad, { now: clock.t })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    const noTime = db.makePost({ targets: [{ accountId: ACCOUNTS.th, platform: 'threads', format: 'text' }] });
    expect(() => schedule(noTime, { now: clock.t })).toThrow(expect.objectContaining({ code: 'NO_TIME' }));
  });

  it('retry and cancel', async () => {
    const { postId, targetId } = scheduledPost({ platform: 'threads', accountId: ACCOUNTS.th, format: 'text', at: T + 60 * MIN });
    updateTarget(targetId, { state: 'failed', lastErrorCode: '100' });
    q.run("UPDATE planner_posts SET status = 'failed' WHERE id = ?", postId);
    retry(targetId, { now: T });
    expect(getTarget(targetId)).toMatchObject({ state: 'queued', lastErrorCode: null, nextAttemptAt: T + 60 * MIN });
    expect(getPost(postId).status).toBe('scheduled');
    expect(() => retry(targetId)).toThrow(expect.objectContaining({ code: 'NOT_RETRYABLE' }));
    await cancel(targetId);
    expect(getTarget(targetId).state).toBe('canceled');
    expect(getPost(postId).status).toBe('draft'); // every target canceled
    updateTarget(targetId, { state: 'publishing' });
    await expect(cancel(targetId)).rejects.toMatchObject({ code: 'TARGET_LOCKED' });
  });
});
