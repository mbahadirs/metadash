import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import instagram from '../src/main/publishing/platforms/instagram.js';
import { metaClient } from '../src/main/meta/client.js';
import { MetaError } from '../src/main/meta/errors.js';
import { classify } from '../src/main/publishing/errors.js';
import { createWorker } from '../src/main/publishing/worker.js';
import { createPublishContext } from '../src/main/publishing/context.js';
import { setMediaHostSettings, createMediaHost } from '../src/main/publishing/hosts/index.js';
import { getPost, getTarget, updateTarget, listUploads } from '../src/main/db/queries/planner.js';
import { createPublishWorld, graphError, setupPublishingDb, IG_ID, ACCOUNTS } from './fixtures/graph/publish.js';

const MIN = 60_000;
let db;
let world;
let files;

beforeAll(() => {
  db = setupPublishingDb('metadash-ig-');
  files = {
    jpg: path.join(db.dir, 'a.jpg'),
    mp4: path.join(db.dir, 'v.mp4'),
  };
  fs.writeFileSync(files.jpg, Buffer.alloc(10, 1));
  fs.writeFileSync(files.mp4, Buffer.alloc(2048, 2));
});
afterAll(() => { vi.unstubAllGlobals(); db.cleanup(); });
beforeEach(() => {
  world = createPublishWorld();
  vi.stubGlobal('fetch', vi.fn(world.fetch));
});

const ctx = { meta: metaClient, tokenFor: () => 'USER_TOKEN', pageToken: async () => 'PAGE_TOKEN', now: Date.now };
const image = (n = 1, extra = {}) => ({ assetId: n, asset: { kind: 'image', format: 'jpeg', mime: 'image/jpeg', bytes: 10, width: 1080, fileName: 'a.jpg' }, altText: null, filePath: files.jpg, url: `https://cdn.test/${n}.jpg`, ...extra });
const video = (n = 9) => ({ assetId: n, asset: { kind: 'video', format: 'mp4', mime: 'video/mp4', bytes: 2048, fileName: 'v.mp4' }, altText: null, filePath: files.mp4, url: null });
function job(format, media, { options = {}, containerId = null, caption = 'Hello #launch' } = {}) {
  return {
    target: { id: 1, accountId: IG_ID, platform: 'instagram', format, options, captionOverride: null, firstCommentOverride: null, containerId, remoteId: null },
    post: { id: 1, caption, firstComment: null, scheduledAt: Date.now() },
    account: { externalId: IG_ID, pageId: '555' },
    media,
    cover: null,
  };
}

describe('Instagram publisher', () => {
  it('image: container with image_url, caption and alt text; publish; permalink', async () => {
    const j = job('image', [image(1, { altText: 'A red chair' })], { options: { locationId: '123' } });
    const { containerId } = await instagram.prepare(ctx, j);
    const create = world.find('POST', `/${IG_ID}/media`)[0];
    expect(create.form).toMatchObject({ image_url: 'https://cdn.test/1.jpg', caption: 'Hello #launch', alt_text: 'A red chair', location_id: '123', access_token: 'USER_TOKEN' });
    j.target.containerId = containerId;
    expect(await instagram.status(ctx, j)).toMatchObject({ status: 'FINISHED' });
    expect(world.find('GET', `/${containerId}`)[0].query.get('fields')).toBe('status_code,status');
    const res = await instagram.publish(ctx, j);
    expect(world.find('POST', `/${IG_ID}/media_publish`)[0].form.creation_id).toBe(containerId);
    expect(res).toMatchObject({ remoteId: expect.stringMatching(/^m/), permalink: expect.stringContaining('instagram.com/p/'), mediaKey: res.remoteId });
  });

  it('carousel of images: children with is_carousel_item, then a CAROUSEL parent', async () => {
    const j = job('carousel', [image(1), image(2)]);
    const res = await instagram.prepare(ctx, j);
    const creates = world.find('POST', `/${IG_ID}/media`);
    expect(creates).toHaveLength(3);
    expect(creates[0].form).toMatchObject({ image_url: 'https://cdn.test/1.jpg', is_carousel_item: 'true' });
    expect(creates[0].form.caption).toBeUndefined();
    expect(creates[2].form).toMatchObject({ media_type: 'CAROUSEL', children: 'c1,c2', caption: 'Hello #launch' });
    expect(res).toEqual({ containerId: 'c3' });
  });

  it('carousel with a video child waits for the children before creating the parent', async () => {
    world = createPublishWorld({ containerStatuses: ['IN_PROGRESS', 'FINISHED'] });
    vi.stubGlobal('fetch', vi.fn(world.fetch));
    const j = job('carousel', [image(1), video()]);
    const first = await instagram.prepare(ctx, j);
    expect(first).toEqual({ containerId: 'children:c1,c2', pending: true });
    expect(world.state.uploads).toHaveLength(1); // the video child went through rupload
    j.target.containerId = first.containerId;
    expect(instagram.needsPrepare(j.target)).toBe(true);
    expect(await instagram.prepare(ctx, j)).toEqual({ containerId: 'children:c1,c2', pending: true });
    const done = await instagram.prepare(ctx, j);
    expect(done.containerId).toBe('c3');
    expect(world.find('POST', `/${IG_ID}/media`)[2].form).toMatchObject({ media_type: 'CAROUSEL', children: 'c1,c2' });
  });

  it('reel: resumable container + rupload with OAuth, offset and file_size headers', async () => {
    const j = job('reel', [video()], { options: { shareToFeed: false, thumbOffsetMs: 1500, collaborators: ['a', 'b', 'c', 'd'] } });
    const { containerId } = await instagram.prepare(ctx, j);
    const create = world.find('POST', `/${IG_ID}/media`)[0];
    expect(create.form).toMatchObject({ media_type: 'REELS', upload_type: 'resumable', share_to_feed: 'false', thumb_offset: '1500', caption: 'Hello #launch', collaborators: '["a","b","c"]' });
    const up = world.state.uploads[0];
    expect(up.url.toString()).toBe(`https://rupload.facebook.com/ig-api-upload/v26.0/${containerId}`);
    expect(up.headers).toMatchObject({ authorization: 'OAuth USER_TOKEN', offset: '0', file_size: '2048' });
    expect(up.body).toBeInstanceOf(Blob);
  });

  it('stories: image via image_url, video via resumable upload; caption is not sent', async () => {
    await instagram.prepare(ctx, job('story', [image(1)]));
    await instagram.prepare(ctx, job('story', [video()]));
    const [img, vid] = world.find('POST', `/${IG_ID}/media`);
    expect(img.form).toMatchObject({ media_type: 'STORIES', image_url: 'https://cdn.test/1.jpg' });
    expect(img.form.caption).toBeUndefined();
    expect(vid.form).toMatchObject({ media_type: 'STORIES', upload_type: 'resumable' });
    expect(world.state.uploads).toHaveLength(1);
  });

  it('recover: PUBLISHED container → found by caption; FINISHED → provably not published', async () => {
    const j = job('image', [image(1)]);
    const since = Date.now() - 1000;
    j.target.containerId = (await instagram.prepare(ctx, j)).containerId;
    expect(await instagram.recover(ctx, j, { since })).toEqual({ notPublished: true, status: 'FINISHED' });
    const pub = await instagram.publish(ctx, j);
    expect((await instagram.recover(ctx, j, { since })).found).toMatchObject({ remoteId: pub.remoteId, mediaKey: pub.remoteId });
  });

  it('first comment and quota', async () => {
    const j = job('image', [image(1)]);
    j.target.remoteId = 'm42';
    expect((await instagram.firstComment(ctx, j, 'first!')).id).toMatch(/^cm/);
    expect(world.find('POST', '/m42/comments')[0].form.message).toBe('first!');
    expect(await instagram.quota(ctx, { externalId: IG_ID })).toEqual({ used: 1, total: 100, windowSec: 86400 });
    expect(world.find('GET', `/${IG_ID}/content_publishing_limit`)[0].query.get('fields')).toBe('config,quota_usage');
  });

  it('a quota-exhausted media_publish is classified as quota (retried later)', async () => {
    world.override((req) => (req.path.endsWith('/media_publish') ? graphError(9, 'Application request limit reached', { subcode: 2207042 }) : undefined));
    const j = job('image', [image(1)], { containerId: 'c1' });
    const err = await instagram.publish(ctx, j).catch((e) => e);
    expect(err).toBeInstanceOf(MetaError);
    expect(classify(err)).toMatchObject({ kind: 'quota', retryable: true, fbtraceId: 'TRACE1' });
  });

  it('needs JPEG ≤1440 px: PNG and wide JPEGs get a conversion variant', () => {
    expect(instagram.imageVariant(image(1))).toBeNull();
    expect(instagram.imageVariant({ asset: { kind: 'image', format: 'png', width: 800 } })).toMatchObject({ variant: 'ig1440', maxWidth: 1440 });
    expect(instagram.imageVariant({ asset: { kind: 'image', format: 'jpeg', width: 3000 } })).toMatchObject({ maxWidth: 1440 });
    expect(instagram.imageVariant(video())).toBeNull();
  });
});

describe('Instagram end to end through the worker (S3 host, JPEG conversion)', () => {
  it('PNG → converted JPEG → S3 → container → published; the S3 copy is deleted afterwards', async () => {
    const T = Date.now() + 10 * MIN;
    let now = T - 5 * MIN;
    setMediaHostSettings({ type: 's3', s3: { endpoint: 'https://s3.test', bucket: 'media', pathStyle: true, region: 'auto', deleteAfterPublish: true }, accessKeyId: 'AKIDTEST', secretAccessKey: 'secret' });
    const converted = [];
    const png = db.makeAsset({ format: 'png', width: 2000, height: 2000 });
    const postId = db.makePost({ status: 'scheduled', scheduledAt: T, firstComment: 'hi', targets: [{ accountId: ACCOUNTS.ig, platform: 'instagram', format: 'image' }], assets: [png] });
    const t = getPost(postId).targets[0];
    updateTarget(t.id, { state: 'queued', nextAttemptAt: now });
    const w = createWorker({
      now: () => now, setTimer: () => 0, clearTimer: () => {}, emit: () => {}, on: null, isDemo: () => false,
      createHost: () => createMediaHost({ fetchImpl: world.fetch }),
      makeContext: () => createPublishContext({ now: () => now }),
      convertImage: async ({ filePath, outPath, maxWidth }) => { converted.push({ filePath, maxWidth }); fs.writeFileSync(outPath, Buffer.from('jpeg')); return outPath; },
      notifier: { published: async () => true, failed: async () => true, missed: async () => true, authPaused: async () => true, quota: async () => true },
      tokenFingerprint: () => 'fp',
    });
    const step = async () => { await w.tick(); await w.idle(); };
    await step();
    expect(converted).toEqual([{ filePath: path.join(db.mediaRoot, png.storedPath), maxWidth: 1440 }]);
    const put = world.find('PUT', /\/media\/metadash\/.*-ig1440\.jpg$/);
    expect(put).toHaveLength(1);
    const create = world.find('POST', `/${IG_ID}/media`)[0];
    expect(new URL(create.form.image_url).host).toBe('s3.test');
    expect(create.form.image_url).toContain('-ig1440.jpg');
    expect(listUploads({ assetId: png.id })).toHaveLength(1);
    now += 15_000; // first status poll after firstPollDelayMs
    await step();
    expect(getTarget(t.id).state).toBe('ready');
    now = T;
    await step();
    const done = getTarget(t.id);
    expect(done).toMatchObject({ state: 'published', firstCommentId: expect.stringMatching(/^cm/) });
    expect(done.permalink).toContain('instagram.com/p/');
    expect(getPost(postId).status).toBe('published');
    expect(world.find('DELETE', /-ig1440\.jpg$/)).toHaveLength(1);
    expect(listUploads({ assetId: png.id })).toHaveLength(0);
    expect(fs.readdirSync(path.join(db.mediaRoot, 'tmp'))).toEqual([]); // converted temp file removed
  });
});
