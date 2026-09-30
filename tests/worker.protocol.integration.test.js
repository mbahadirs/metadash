import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createWorkerApp } from '../worker/src/server.js';
import { createPublishWorld, setupPublishingDb, ACCOUNTS, IG_ID, PAGE_TOKEN } from './fixtures/graph/publish.js';
import { tmpDir, DATA_KEY } from './worker.fixtures.js';
import { generateSecret, deriveKey, signedHeaders, encodePairing } from '../src/shared/publish/protocol.js';
import { q } from '../src/main/db/index.js';
import { getTarget, getPost, updateTarget, updatePost, setPostStatus } from '../src/main/db/queries/planner.js';
import { nextDue } from '../src/main/publishing/worker.js';
import { configure, test as testConnection, pushToken, disconnect, setWorkerServiceDeps, revokeToken, rotateSecret } from '../src/main/worker/service.js';
import { readSecret } from '../src/main/worker/config.js';
import { syncNow, setExecutor, recall, workerState } from '../src/main/worker/sync.js';
import { itemIdFor } from '../src/main/worker/config.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 1, 12, 0);
const realFetch = globalThis.fetch;
const clock = { t: T0 };
const now = () => clock.t;
const SECRET = generateSecret();
let db;
let world;
let app;
let url;
let dataDir;
let permissions = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_manage_posts'];

beforeAll(async () => {
  db = setupPublishingDb('metadash-wkr-int-');
  world = createPublishWorld({ now });
  world.override((req) => (req.path === '/me/permissions' ? { data: permissions.map((permission) => ({ permission, status: 'granted' })) } : undefined));
  world.override((req) => (req.path === '/me' ? { id: 'me' } : undefined));
  vi.stubGlobal('fetch', world.fetch); // desktop Graph calls
  dataDir = tmpDir('mdw-int-');
  app = createWorkerApp({ dataDir, secret: SECRET, dataKey: DATA_KEY, publicUrl: 'https://worker.test', fetchImpl: world.fetch, now, rateLimit: { capacity: 10_000, perMinute: 10_000 } });
  const addr = await app.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${addr.port}`;
  setWorkerServiceDeps({ fetchImpl: realFetch, now });
});

afterAll(async () => {
  await app.close();
  vi.unstubAllGlobals();
  db.cleanup();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => { clock.t = T0; });

/** A scheduled post with one queued target, handed to the worker. */
async function workerPost({ caption = 'Hello worker', at = T0 + 10 * MIN, platform = 'instagram', accountId = ACCOUNTS.ig, format = 'image' } = {}) {
  const asset = db.makeAsset();
  const postId = db.makePost({ caption, scheduledAt: at, status: 'scheduled', targets: [{ accountId, platform, format }], assets: format === 'text' ? [] : [asset] });
  const [t] = getPost(postId).targets;
  updateTarget(t.id, { state: 'queued', nextAttemptAt: at - 5 * MIN });
  const r = await setExecutor({ targetIds: [t.id], executor: 'worker' });
  expect(r).toMatchObject({ updated: 1, skipped: [] });
  return { postId, targetId: t.id, asset };
}

async function signed(method, path, body = '') {
  const headers = signedHeaders(deriveKey(SECRET, 'auth'), { method, path, body, now: now() });
  return realFetch(url + path, { method, headers, ...(body ? { body } : {}) });
}

describe('worker protocol (desktop client ↔ in-process worker)', () => {
  it('serves an unsigned minimal health check and refuses unsigned or wrongly signed API calls', async () => {
    const h = await (await realFetch(`${url}/v1/health`)).json();
    expect(h).toEqual({ ok: true, protocol: 1, version: expect.any(String) });
    expect((await realFetch(`${url}/v1/info`)).status).toBe(400); // no protocol header
    const bad = signedHeaders(deriveKey(generateSecret(), 'auth'), { method: 'GET', path: '/v1/info', now: now() });
    expect((await realFetch(`${url}/v1/info`, { headers: bad })).status).toBe(401);
    expect((await signed('GET', '/v1/info')).status).toBe(200);
  });

  it('configure refuses a wrong secret and accepts a pairing string', async () => {
    await expect(configure({ url, secret: generateSecret() })).rejects.toMatchObject({ code: 'WORKER_AUTH' });
    const state = await configure({ pairing: encodePairing(url, SECRET) });
    expect(state).toMatchObject({ configured: true, url, info: { version: expect.any(String), publicMediaUrl: true } });
    expect(await testConnection()).toMatchObject({ ok: true, protocol: 1 });
  });

  it('refuses tokens with scopes beyond publishing unless allowed, and sends the Page token for Facebook', async () => {
    permissions = [...permissions, 'ads_read'];
    await expect(pushToken({ accountId: ACCOUNTS.ig })).rejects.toMatchObject({ code: 'BROAD_SCOPES' });
    const allowed = await pushToken({ accountId: ACCOUNTS.ig, allowBroader: true });
    expect(allowed).toMatchObject({ tokenKey: `instagram:${ACCOUNTS.ig}`, status: 'ok' });
    permissions = permissions.filter((p) => p !== 'ads_read');
    await pushToken({ accountId: ACCOUNTS.ig });
    await pushToken({ accountId: ACCOUNTS.fb });
    const stored = app.store.getToken(`facebook:${ACCOUNTS.fb}`);
    expect(app.tokens.tokenFor(`facebook:${ACCOUNTS.fb}`)).toBe(PAGE_TOKEN);
    expect(JSON.stringify(stored)).not.toContain(PAGE_TOKEN); // encrypted at rest
    expect(fs.readFileSync(app.store.file, 'utf8')).not.toContain('USER_TOKEN');
    expect(workerState().tokens.map((t) => t.tokenKey).sort()).toEqual([`facebook:${ACCOUNTS.fb}`, `instagram:${ACCOUNTS.ig}`]);
  });

  it('pushes a target, the worker publishes it on time, and the desktop pulls the result', async () => {
    const { postId, targetId } = await workerPost();
    expect(nextDue({ now: now() })).toBeNull(); // the local tray publisher does not see worker targets
    const first = await syncNow();
    expect(first).toMatchObject({ pushed: 1, errors: [] });
    const t = getTarget(targetId);
    expect(t).toMatchObject({ executor: 'worker', workerRevision: t.revision, workerStatus: 'queued' });
    const item = app.store.getItem(itemIdFor(t));
    expect(item.payload).toMatchObject({ format: 'image', caption: 'Hello worker', externalId: IG_ID });
    expect(item.payload.media[0].sha256).toMatch(/^[a-f0-9]{64}$/);

    clock.t = T0 + 5 * MIN; await app.scheduler.tick();
    clock.t += 20_000; await app.scheduler.tick();
    clock.t = T0 + 10 * MIN; await app.scheduler.tick();
    expect(app.store.getItem(item.id)).toMatchObject({ status: 'published' });

    // Meta fetched the image from the worker's signed URL.
    const created = world.find('POST', `/${IG_ID}/media`).at(-1);
    const mediaUrl = new URL(created.form.image_url);
    const served = await realFetch(`${url}${mediaUrl.pathname}${mediaUrl.search}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    mediaUrl.searchParams.set('sig', 'x'.repeat(43));
    expect((await realFetch(`${url}${mediaUrl.pathname}${mediaUrl.search}`)).status).toBe(404);

    const second = await syncNow();
    expect(second.pulled).toBeGreaterThanOrEqual(1);
    expect(getTarget(targetId)).toMatchObject({ state: 'published', workerStatus: 'published', remoteId: expect.any(String), permalink: expect.stringContaining('instagram.com') });
    expect(getPost(postId).status).toBe('published');
    expect(workerState().lastError).toBeNull();
  });

  it('recall succeeds while queued and hands the target back to this computer', async () => {
    const { targetId } = await workerPost({ at: T0 + 3 * 60 * MIN });
    await syncNow();
    const id = itemIdFor(getTarget(targetId));
    expect(app.store.getItem(id)).not.toBeNull();
    expect(await recall({ targetId })).toEqual({ recalled: true });
    expect(getTarget(targetId)).toMatchObject({ executor: 'local', workerRevision: null });
    expect(app.store.getItem(id)).toBeNull();
  });

  it('recall conflicts (409) once the worker started publishing', async () => {
    const { targetId } = await workerPost({ at: T0 + 10 * MIN });
    await syncNow();
    clock.t = T0 + 6 * MIN; await app.scheduler.tick(); // container created → publishing
    expect(await recall({ targetId })).toEqual({ recalled: false, reason: 'publishing' });
    expect(getTarget(targetId).executor).toBe('worker');
  });

  it('edits bump the revision; the worker accepts a newer revision while queued and refuses it once publishing', async () => {
    const { postId, targetId } = await workerPost({ at: T0 + 60 * MIN });
    await syncNow();
    const before = getTarget(targetId);
    updatePost(postId, { caption: 'Edited caption' });
    const edited = getTarget(targetId);
    expect(edited.revision).toBe(before.revision + 1);
    expect(await syncNow()).toMatchObject({ pushed: 1 });
    const item = app.store.getItem(itemIdFor(edited));
    expect(item).toMatchObject({ revision: edited.revision, payload: { caption: 'Edited caption' } });

    clock.t = T0 + 56 * MIN; await app.scheduler.tick(); // publishing
    setPostStatus(postId, 'scheduled', { actor: 'system' });
    updatePost(postId, { caption: 'Too late' });
    const res = await syncNow();
    expect(res.errors).toEqual(expect.arrayContaining([expect.objectContaining({ targetId, code: 'in_progress' })]));
    expect(app.store.getItem(item.id).payload.caption).toBe('Edited caption');
    expect(getTarget(targetId).workerError).toMatchObject({ code: 'in_progress' });
  });

  it('reports missed items and failures back as planner states', async () => {
    const { targetId } = await workerPost({ at: T0 + 10 * MIN });
    await syncNow();
    clock.t = T0 + 10 * MIN + 400 * MIN; await app.scheduler.tick();
    await syncNow();
    expect(getTarget(targetId)).toMatchObject({ state: 'missed', workerStatus: 'missed', lastErrorCode: 'missed' });
  });

  it('rejects a replayed signed request', async () => {
    const headers = signedHeaders(deriveKey(SECRET, 'auth'), { method: 'GET', path: '/v1/info', now: now() });
    expect((await realFetch(`${url}/v1/info`, { headers })).status).toBe(200);
    const again = await realFetch(`${url}/v1/info`, { headers });
    expect(again.status).toBe(401);
    expect((await again.json()).error.code).toBe('replay');
  });

  it('rejects media whose bytes do not match the sha256', async () => {
    const body = crypto.randomBytes(32);
    const fake = crypto.createHash('sha256').update('other').digest('hex');
    const headers = { ...signedHeaders(deriveKey(SECRET, 'auth'), { method: 'PUT', path: `/v1/media/${fake}`, bodyHash: fake, now: now() }), 'content-type': 'image/jpeg' };
    const res = await realFetch(`${url}/v1/media/${fake}`, { method: 'PUT', headers, body });
    expect(res.status).toBe(422);
  });

  it('rotates the secret: the worker switches after confirming, the old secret is refused afterwards', async () => {
    const r = await rotateSecret();
    expect(r).toMatchObject({ rotated: true, envLine: expect.stringMatching(/^MD_WORKER_SECRET=/) });
    const next = readSecret();
    expect(next).not.toBe(SECRET);
    expect(await testConnection()).toMatchObject({ ok: true });
    expect((await signed('GET', '/v1/info')).status).toBe(401); // signed with the old secret
    expect(app.store.getMeta('rotatedSecret')).toMatchObject({ sealed: expect.stringMatching(/^v1\./) });
    expect(JSON.stringify(app.store.getMeta('rotatedSecret'))).not.toContain(next);
  });

  it('revokes a token and disconnect wipes the worker and returns targets to this computer', async () => {
    const { targetId } = await workerPost({ at: T0 + 3 * 60 * MIN });
    await syncNow();
    await revokeToken({ tokenKey: `facebook:${ACCOUNTS.fb}` });
    expect(app.store.getToken(`facebook:${ACCOUNTS.fb}`)).toBeNull();
    expect(await disconnect()).toBe(true);
    expect(app.store.listItems()).toEqual([]);
    expect(app.store.listTokens()).toEqual([]);
    expect(getTarget(targetId)).toMatchObject({ executor: 'local', workerRevision: null });
    expect(workerState()).toMatchObject({ configured: false, tokens: [] });
    expect(q.get('SELECT COUNT(*) AS n FROM worker_tokens').n).toBe(0);
  });
});
