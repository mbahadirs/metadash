import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import { makeWorkerParts, igItem, T0 } from './worker.fixtures.js';
import { createPublishWorld, graphError, IG_ID } from './fixtures/graph/publish.js';
import { backoffMs, LEAD_IMAGE_MS, MAX_ATTEMPTS } from '../worker/src/scheduler.js';
import { createScheduler } from '../worker/src/scheduler.js';
import { silentLogger } from '../worker/src/log.js';

const dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

async function setup(worldOpts = {}) {
  const parts = makeWorkerParts({ fetchImpl: (...a) => world.fetch(...a) });
  const world = createPublishWorld({ ...worldOpts, now: parts.now });
  dirs.push(parts.dir);
  parts.addToken(`instagram:${IG_ID}`, 'IG_WORKER_TOKEN');
  const sha = await parts.addMedia();
  const item = igItem({ payload: { ...igItem().payload, media: [{ sha256: sha, kind: 'image', mime: 'image/jpeg', bytes: 64, format: 'jpeg', width: 1080 }] } });
  expect(parts.push([item])[0]).toMatchObject({ result: 'accepted', workerRevision: 1, status: 'queued' });
  const advance = async (ms) => { parts.clock.t += ms; await parts.scheduler.tick(); return parts.store.getItem(item.id); };
  return { ...parts, world, item, advance };
}

describe('worker scheduler', () => {
  it('prepares the container ahead of time and publishes at the scheduled time with the shared IG publisher', async () => {
    const s = await setup();
    let it = await s.advance(0);
    expect(it).toMatchObject({ status: 'queued', step: null }); // not yet inside the lead window
    it = await s.advance(10 * 60_000 - LEAD_IMAGE_MS);
    expect(it).toMatchObject({ status: 'publishing', step: 'container_created' });
    const created = s.world.find('POST', `/${IG_ID}/media`)[0];
    expect(created.form.image_url).toMatch(/^https:\/\/worker\.test\/m\/[a-f0-9]{64}\?exp=\d+&sig=/);
    expect(created.form.access_token).toBe('IG_WORKER_TOKEN');
    it = await s.advance(20_000);
    expect(it).toMatchObject({ step: 'ready', nextAttemptAt: T0 + 10 * 60_000 });
    expect(s.world.find('POST', `/${IG_ID}/media_publish`)).toHaveLength(0);
    it = await s.advance(T0 + 10 * 60_000 - s.clock.t);
    expect(it).toMatchObject({ status: 'published', step: null, remoteId: expect.any(String), permalink: expect.stringContaining('instagram.com') });
    expect(s.world.find('POST', `/${IG_ID}/media_publish`)).toHaveLength(1);
  });

  it('backs off transient errors 1, 2, 5, 10, 30 min and fails after 6 attempts', async () => {
    const s = await setup();
    s.world.override((req) => (req.method === 'POST' && req.path === `/${IG_ID}/media` ? graphError(2, 'temporary', { status: 500 }) : undefined));
    let it = await s.advance(10 * 60_000);
    expect(it).toMatchObject({ status: 'queued', attempts: 1, lastError: { transient: true } });
    expect(it.nextAttemptAt - s.clock.t).toBe(backoffMs(1));
    const seen = [];
    for (let i = 2; i <= MAX_ATTEMPTS; i += 1) {
      it = await s.advance(it.nextAttemptAt - s.clock.t);
      seen.push(it.status === 'failed' ? 'failed' : (it.nextAttemptAt - s.clock.t) / 60_000);
    }
    expect(seen).toEqual([2, 5, 10, 30, 'failed']);
    expect(it).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
  });

  it('marks items missed when the worker was down beyond maxLateMinutes (never published late silently)', async () => {
    const s = await setup();
    const it = await s.advance(10 * 60_000 + 361 * 60_000);
    expect(it).toMatchObject({ status: 'missed', lastError: { code: 'missed' } });
    expect(s.world.calls).toHaveLength(0);
  });

  it('fails permanently on auth errors and marks the token invalid', async () => {
    const s = await setup();
    s.world.override((req) => (req.method === 'POST' ? graphError(190, 'expired') : undefined));
    const it = await s.advance(10 * 60_000);
    expect(it).toMatchObject({ status: 'failed', lastError: { code: '190', transient: false } });
    expect(s.tokens.list()[0]).toMatchObject({ valid: false });
  });

  it('resumes after a crash in publish_called: recovers the published post and never publishes twice', async () => {
    const s = await setup();
    await s.advance(10 * 60_000 - LEAD_IMAGE_MS);
    await s.advance(20_000);
    await s.advance(T0 + 10 * 60_000 - s.clock.t - 1); // still ready, before the time
    // Simulate: publish reached Meta, then the process died before persisting the result.
    let it = s.store.getItem(s.item.id);
    await s.world.fetch(`https://graph.facebook.com/v26.0/${IG_ID}/media_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: it.containerId }).toString() });
    s.store.putItem({ ...it, step: 'publish_called', startedAt: s.clock.t, nextAttemptAt: s.clock.t });
    // Restart: a new scheduler over the same store resumes from the persisted step.
    const restarted = createScheduler({ store: s.store, tokens: s.tokens, media: s.media, fetchImpl: s.world.fetch, now: s.now, log: silentLogger });
    s.clock.t += 1000;
    await restarted.tick();
    it = s.store.getItem(s.item.id);
    expect(it).toMatchObject({ status: 'published', remoteId: expect.any(String) });
    expect(s.world.find('POST', `/${IG_ID}/media_publish`)).toHaveLength(1);
  });

  it('recreates an expired container once', async () => {
    const s = await setup({ containerStatuses: ['EXPIRED'] });
    await s.advance(10 * 60_000 - LEAD_IMAGE_MS);
    let it = await s.advance(20_000);
    expect(it).toMatchObject({ step: null, containerId: null, recreated: true });
    it = await s.advance(0);
    expect(it).toMatchObject({ step: 'container_created' });
    it = await s.advance(20_000);
    expect(it).toMatchObject({ status: 'failed', lastError: { code: 'container_expired' } });
  });

  it('defers publishing while the IG daily quota is exhausted', async () => {
    const s = await setup({ quotaUsed: 100, quotaTotal: 100 });
    await s.advance(10 * 60_000 - LEAD_IMAGE_MS);
    await s.advance(20_000);
    const it = await s.advance(T0 + 10 * 60_000 - s.clock.t);
    expect(it).toMatchObject({ status: 'publishing', step: 'ready', lastError: { code: 'quota' } });
    expect(s.world.find('POST', `/${IG_ID}/media_publish`)).toHaveLength(0);
  });

  it('prunes completed items after 30 days', async () => {
    const s = await setup();
    s.store.putItem({ ...s.store.getItem(s.item.id), status: 'published', completedAt: s.clock.t });
    s.clock.t += 31 * 86_400_000;
    await s.scheduler.prune();
    expect(s.store.getItem(s.item.id)).toBeNull();
  });
});
