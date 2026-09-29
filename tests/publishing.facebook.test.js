import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import facebook from '../src/main/publishing/platforms/facebook.js';
import { metaClient } from '../src/main/meta/client.js';
import { createWorker } from '../src/main/publishing/worker.js';
import { createPublishContext, clearPageTokenCache } from '../src/main/publishing/context.js';
import { getPost, getTarget, updateTarget, listAudit } from '../src/main/db/queries/planner.js';
import { q } from '../src/main/db/index.js';
import { createPublishWorld, graphError, json, setupPublishingDb, PAGE_ID, PAGE_TOKEN, ACCOUNTS } from './fixtures/graph/publish.js';

const MIN = 60_000;
let db;
let world;
let files;

beforeAll(() => {
  db = setupPublishingDb('metadash-fb-');
  files = { jpg: path.join(db.dir, 'a.jpg'), mp4: path.join(db.dir, 'v.mp4') };
  fs.writeFileSync(files.jpg, Buffer.alloc(10, 1));
  fs.writeFileSync(files.mp4, Buffer.alloc(4096, 2));
});
afterAll(() => { vi.unstubAllGlobals(); db.cleanup(); });
beforeEach(() => {
  world = createPublishWorld();
  vi.stubGlobal('fetch', vi.fn(world.fetch));
  clearPageTokenCache();
});

const ctx = { meta: metaClient, tokenFor: () => 'USER_TOKEN', pageToken: async () => PAGE_TOKEN };
const photo = (n = 1, extra = {}) => ({ assetId: n, asset: { kind: 'image', format: 'jpeg', mime: 'image/jpeg', bytes: 10, fileName: `p${n}.jpg` }, altText: null, filePath: files.jpg, url: null, ...extra });
const clip = () => ({ assetId: 9, asset: { kind: 'video', format: 'mp4', mime: 'video/mp4', bytes: 4096, fileName: 'v.mp4' }, altText: null, filePath: files.mp4, url: null });
function job(format, media = [], { options = {}, containerId = null, scheduledAt = Date.now() + 60 * MIN } = {}) {
  return {
    target: { id: 1, accountId: `fb-${PAGE_ID}`, platform: 'facebook', format, options, captionOverride: null, firstCommentOverride: null, containerId, remoteId: null, mode: 'app' },
    post: { id: 1, caption: 'Big news', firstComment: null, scheduledAt },
    account: { externalId: PAGE_ID, pageId: PAGE_ID },
    media,
    cover: null,
  };
}

describe('Facebook publisher', () => {
  it('photo: multipart `source` + caption with the Page token; post id = pageid_postid', async () => {
    const res = await facebook.publish(ctx, job('photo', [photo(1, { altText: 'Alt' })]));
    const call = world.find('POST', `/${PAGE_ID}/photos`)[0];
    expect(call.form.source).toBeInstanceOf(Blob);
    expect(call.form).toMatchObject({ caption: 'Big news', alt_text_custom: 'Alt', access_token: PAGE_TOKEN });
    expect(call.form.published).toBeUndefined();
    expect(res.remoteId).toMatch(new RegExp(`^${PAGE_ID}_ph`));
    expect(res.mediaKey).toBe(res.remoteId);
    expect(res.permalink).toBe(`https://www.facebook.com/${res.remoteId}`);
  });

  it('native schedule sends published=false + scheduled_publish_time in seconds', async () => {
    const at = Date.UTC(2026, 9, 5, 9, 30, 12);
    const { containerId } = await facebook.scheduleNative(ctx, job('photo', [photo()]), at);
    const call = world.find('POST', `/${PAGE_ID}/photos`)[0];
    expect(call.form).toMatchObject({ published: 'false', scheduled_publish_time: String(Math.floor(at / 1000)) });
    expect(containerId).toMatch(new RegExp(`^${PAGE_ID}_`));
    await facebook.scheduleNative(ctx, job('text'), at);
    expect(world.find('POST', `/${PAGE_ID}/feed`)[0].form).toMatchObject({ message: 'Big news', published: 'false', scheduled_publish_time: String(Math.floor(at / 1000)) });
  });

  it('album: unpublished photos, then /feed with attached_media[i] (temporary when scheduled)', async () => {
    await facebook.publish(ctx, job('album', [photo(1), photo(2)]));
    const photos = world.find('POST', `/${PAGE_ID}/photos`);
    expect(photos.map((p) => p.form.published)).toEqual(['false', 'false']);
    expect(photos[0].form.temporary).toBeUndefined();
    const feed = world.find('POST', `/${PAGE_ID}/feed`)[0].form;
    expect(JSON.parse(feed['attached_media[0]'])).toEqual({ media_fbid: 'ph1' });
    expect(JSON.parse(feed['attached_media[1]'])).toEqual({ media_fbid: 'ph2' });
    expect(feed.message).toBe('Big news');
    world.reset();
    await facebook.scheduleNative(ctx, job('album', [photo(1), photo(2)]), Date.now() + 60 * MIN);
    expect(world.find('POST', `/${PAGE_ID}/photos`).map((p) => p.form.temporary)).toEqual(['true', 'true']);
  });

  it('link post and video upload on graph-video.facebook.com', async () => {
    await facebook.publish(ctx, job('link', [], { options: { link: 'https://example.com/a' } }));
    expect(world.find('POST', `/${PAGE_ID}/feed`)[0].form).toMatchObject({ link: 'https://example.com/a', message: 'Big news' });
    const res = await facebook.publish(ctx, job('video', [clip()]));
    const up = world.find('POST', `/${PAGE_ID}/videos`)[0];
    expect(up.host).toBe('graph-video.facebook.com');
    expect(up.form).toMatchObject({ description: 'Big news' });
    expect(up.form.source).toBeInstanceOf(Blob);
    expect(res.mediaKey).toBe(`${PAGE_ID}_p${res.remoteId}`); // post_id of the video
  });

  it('reel: start → rupload (OAuth page token) → finish with video_state', async () => {
    await facebook.publish(ctx, job('reel', [clip()]));
    const phases = world.find('POST', `/${PAGE_ID}/video_reels`).map((c) => c.form.upload_phase);
    expect(phases).toEqual(['start', 'finish']);
    const up = world.state.uploads[0];
    expect(up.url.pathname).toMatch(/^\/video-upload\/v26\.0\/rv/);
    expect(up.headers).toMatchObject({ authorization: `OAuth ${PAGE_TOKEN}`, offset: '0', file_size: '4096' });
    expect(world.find('POST', `/${PAGE_ID}/video_reels`)[1].form).toMatchObject({ video_state: 'PUBLISHED', description: 'Big news' });
    world.reset();
    const at = Date.now() + 2 * 60 * MIN;
    await facebook.scheduleNative(ctx, job('reel', [clip()]), at);
    expect(world.find('POST', `/${PAGE_ID}/video_reels`)[1].form).toMatchObject({ video_state: 'SCHEDULED', scheduled_publish_time: String(Math.floor(at / 1000)) });
  });

  it('reconcile reads is_published and the permalink; cancel deletes', async () => {
    const r = await facebook.reconcile(ctx, job('photo', [photo()], { containerId: `${PAGE_ID}_77` }));
    expect(r).toEqual({ published: true, remoteId: `${PAGE_ID}_77`, permalink: `https://www.facebook.com/${PAGE_ID}_77`, mediaKey: `${PAGE_ID}_77` });
    await facebook.cancelNative(ctx, job('photo', [photo()], { containerId: `${PAGE_ID}_77` }));
    expect(world.state.deleted).toEqual([`${PAGE_ID}_77`]);
    world.override((req) => (req.method === 'DELETE' ? graphError(100, 'does not exist') : undefined));
    await expect(facebook.cancelNative(ctx, job('photo', [photo()], { containerId: 'gone' }))).resolves.toBeUndefined();
  });
});

describe('Facebook through the worker', () => {
  const T = Date.now() + 3 * 60 * MIN;
  let now;
  const makeW = () => createWorker({
    now: () => now, setTimer: () => 0, clearTimer: () => {}, emit: () => {}, on: null, isDemo: () => false,
    createHost: () => null, makeContext: () => createPublishContext({ now: () => now }), tokenFingerprint: () => 'fp',
    notifier: { published: async () => true, failed: async () => true, missed: async () => true, authPaused: async () => true, quota: async () => true },
  });
  const step = async (w) => { await w.tick(); await w.idle(); };

  beforeEach(() => {
    now = T - 2 * 60 * MIN;
    q.run('DELETE FROM planner_targets'); q.run('DELETE FROM planner_post_assets'); q.run('DELETE FROM planner_posts');
  });

  function nativePost() {
    const a = db.makeAsset();
    const postId = db.makePost({ status: 'scheduled', scheduledAt: T, targets: [{ accountId: ACCOUNTS.fb, platform: 'facebook', format: 'photo', mode: 'native' }], assets: [a] });
    const t = getPost(postId).targets[0];
    updateTarget(t.id, { state: 'queued', nextAttemptAt: now });
    return { postId, targetId: t.id };
  }

  it('hands off natively, reconciles after T, and falls back to delete + recreate when rescheduling fails', async () => {
    const w = makeW();
    const { postId, targetId } = nativePost();
    await step(w);
    const handed = getTarget(targetId);
    expect(handed).toMatchObject({ state: 'handed_off', nextAttemptAt: T + 5 * MIN });
    expect(world.find('POST', `/${PAGE_ID}/photos`)[0].form.published).toBe('false');
    // reschedule: POST /{id} fails → DELETE + recreate on the next tick
    world.override((req) => (req.method === 'POST' && req.path === `/${handed.containerId}` ? graphError(100, 'cannot reschedule') : undefined));
    q.run('UPDATE planner_posts SET scheduled_at = ? WHERE id = ?', T + 60 * MIN, postId);
    await w.handleChanged({ postIds: [postId], reason: 'rescheduled' });
    await w.idle();
    expect(world.state.deleted).toContain(handed.containerId);
    expect(getTarget(targetId)).toMatchObject({ state: 'queued', containerId: null });
    await step(w);
    const again = getTarget(targetId);
    expect(again.state).toBe('handed_off');
    expect(again.containerId).not.toBe(handed.containerId);
    expect(listAudit({ postId }).map((a) => a.action)).toEqual(expect.arrayContaining(['handed_off', 'native_canceled', 'native_recreate']));
    now = T + 65 * MIN;
    await step(w);
    expect(getTarget(targetId)).toMatchObject({ state: 'published', permalink: `https://www.facebook.com/${again.containerId}` });
    expect(getPost(postId).status).toBe('published');
  });

  it('a Page without an access token fails the target as a permission problem (not paused)', async () => {
    world.override((req) => (req.method === 'GET' && req.query.get('fields') === 'id,name,access_token' ? json({ id: PAGE_ID, name: 'Brand Page' }) : undefined));
    const w = makeW();
    const { targetId } = nativePost();
    await step(w);
    expect(getTarget(targetId)).toMatchObject({ state: 'failed', lastErrorCode: 'page_token_missing' });
    expect(getTarget(targetId).lastError).toContain('Brand Page');
  });

  it('app mode: photo is published at T with one multipart call', async () => {
    const w = makeW();
    const a = db.makeAsset();
    const postId = db.makePost({ status: 'scheduled', scheduledAt: T, targets: [{ accountId: ACCOUNTS.fb, platform: 'facebook', format: 'photo' }], assets: [a] });
    const t = getPost(postId).targets[0];
    updateTarget(t.id, { state: 'queued', nextAttemptAt: T });
    now = T;
    await step(w);
    expect(getTarget(t.id).state).toBe('ready');
    await step(w);
    expect(getTarget(t.id)).toMatchObject({ state: 'published', mediaKey: expect.stringMatching(new RegExp(`^${PAGE_ID}_`)) });
    expect(world.find('POST', `/${PAGE_ID}/photos`)).toHaveLength(1);
  });
});
