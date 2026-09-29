import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import threads from '../src/main/publishing/platforms/threads.js';
import { threadsClient } from '../src/main/providers/threads/client.js';
import { buildAuthUrl, THREADS_PUBLISH_SCOPES } from '../src/main/providers/threads/auth.js';
import { createWorker } from '../src/main/publishing/worker.js';
import { createPublishContext } from '../src/main/publishing/context.js';
import { setMediaHostSettings } from '../src/main/publishing/hosts/index.js';
import { validatePostLike } from '../src/main/planner/validationContext.js';
import { getPost, getTarget, updateTarget } from '../src/main/db/queries/planner.js';
import { createPublishWorld, setupPublishingDb, TH_ID, ACCOUNTS } from './fixtures/graph/publish.js';

let db;
let world;

beforeAll(() => { db = setupPublishingDb('metadash-th-'); });
afterAll(() => { vi.unstubAllGlobals(); db.cleanup(); });
beforeEach(() => {
  world = createPublishWorld();
  vi.stubGlobal('fetch', vi.fn(world.fetch));
});

const ctx = { threads: threadsClient, tokenFor: (auth) => (auth === 'threads' ? 'TH_TOKEN' : 'USER_TOKEN') };
const image = (n, extra = {}) => ({ assetId: n, asset: { kind: 'image', format: 'jpeg', mime: 'image/jpeg' }, altText: null, url: `https://cdn.test/${n}.jpg`, ...extra });
const video = (n) => ({ assetId: n, asset: { kind: 'video', format: 'mp4', mime: 'video/mp4' }, altText: null, url: `https://cdn.test/${n}.mp4` });
function job(format, media = [], { options = {}, containerId = null } = {}) {
  return {
    target: { id: 1, accountId: `th-${TH_ID}`, platform: 'threads', format, options, captionOverride: null, firstCommentOverride: null, containerId, remoteId: null },
    post: { id: 1, caption: 'Thread text', firstComment: null, scheduledAt: Date.now() },
    account: { externalId: TH_ID },
    media,
    cover: null,
  };
}

describe('Threads publisher', () => {
  it('text post with link attachment and topic tag; publish → th- media key + permalink', async () => {
    const j = job('text', [], { options: { link: 'https://example.com', topicTag: '#launch' } });
    const { containerId } = await threads.prepare(ctx, j);
    const create = world.find('POST', `/${TH_ID}/threads`)[0];
    expect(create.host).toBe('graph.threads.net');
    expect(create.form).toMatchObject({ media_type: 'TEXT', text: 'Thread text', link_attachment: 'https://example.com', topic_tag: 'launch', access_token: 'TH_TOKEN' });
    j.target.containerId = containerId;
    expect(await threads.status(ctx, j)).toEqual({ status: 'FINISHED', message: null });
    expect(world.find('GET', `/${containerId}`)[0].query.get('fields')).toBe('status,error_message');
    const res = await threads.publish(ctx, j);
    expect(world.find('POST', `/${TH_ID}/threads_publish`)[0].form.creation_id).toBe(containerId);
    expect(res.mediaKey).toBe(`th-${res.remoteId}`);
    expect(res.permalink).toContain('threads.net');
    expect(threads.firstPollDelayMs).toBe(30_000);
  });

  it('image and video need public URLs (image_url / video_url + alt_text)', async () => {
    await threads.prepare(ctx, job('image', [image(1, { altText: 'Alt' })]));
    await threads.prepare(ctx, job('video', [video(2)]));
    const [img, vid] = world.find('POST', `/${TH_ID}/threads`);
    expect(img.form).toMatchObject({ media_type: 'IMAGE', image_url: 'https://cdn.test/1.jpg', alt_text: 'Alt', text: 'Thread text' });
    expect(vid.form).toMatchObject({ media_type: 'VIDEO', video_url: 'https://cdn.test/2.mp4' });
    expect(threads.hostedItems(job('carousel', [image(1), video(2)]))).toHaveLength(2);
    await expect(threads.prepare(ctx, job('image', [image(3, { url: null })]))).rejects.toMatchObject({ key: 'pub_host_missing' });
  });

  it('carousel: items, wait for them, then the CAROUSEL container', async () => {
    const j = job('carousel', [image(1), video(2)]);
    const first = await threads.prepare(ctx, j);
    expect(first).toEqual({ containerId: 'children:tc1,tc2', pending: true });
    expect(world.find('POST', `/${TH_ID}/threads`).map((c) => c.form.is_carousel_item)).toEqual(['true', 'true']);
    j.target.containerId = first.containerId;
    const parent = await threads.prepare(ctx, j);
    expect(parent.containerId).toBe('tc3');
    expect(world.find('POST', `/${TH_ID}/threads`)[2].form).toMatchObject({ media_type: 'CAROUSEL', children: 'tc1,tc2', text: 'Thread text' });
  });

  it('first comment = reply (reply_to_id) published through threads_publish', async () => {
    const j = job('text');
    j.target.remoteId = 't99';
    const res = await threads.firstComment(ctx, j, 'more in the replies');
    const reply = world.find('POST', `/${TH_ID}/threads`)[0];
    expect(reply.form).toMatchObject({ media_type: 'TEXT', text: 'more in the replies', reply_to_id: 't99' });
    expect(world.find('POST', `/${TH_ID}/threads_publish`)[0].form.creation_id).toBe('tc1');
    expect(res.id).toMatch(/^t/);
  });

  it('quota from threads_publishing_limit; recover finds a published thread', async () => {
    expect(await threads.quota(ctx, { externalId: TH_ID })).toEqual({ used: 2, total: 250, windowSec: 86400 });
    const j = job('text');
    const since = Date.now() - 1000;
    j.target.containerId = (await threads.prepare(ctx, j)).containerId;
    expect(await threads.recover(ctx, j, { since })).toMatchObject({ notPublished: true });
    const pub = await threads.publish(ctx, j);
    expect((await threads.recover(ctx, j, { since })).found).toMatchObject({ remoteId: pub.remoteId, mediaKey: `th-${pub.remoteId}` });
  });

  it('publishing scopes are opt-in on the authorize URL', () => {
    const plain = new URL(buildAuthUrl({ appId: '1', redirectUri: 'https://localhost/' }));
    expect(plain.searchParams.get('scope')).toBe('threads_basic,threads_manage_insights');
    const pub = new URL(buildAuthUrl({ appId: '1', redirectUri: 'https://localhost/', publish: true }));
    expect(pub.searchParams.get('scope').split(',')).toEqual(expect.arrayContaining([...THREADS_PUBLISH_SCOPES]));
  });
});

describe('Threads without a media host', () => {
  it('validation reports v_media_host_missing and the worker fails the target with pub_host_missing', async () => {
    setMediaHostSettings({ type: 'none' });
    const asset = db.makeAsset();
    const now = Date.now();
    const postId = db.makePost({ status: 'scheduled', scheduledAt: now + 60_000, targets: [{ accountId: ACCOUNTS.th, platform: 'threads', format: 'image' }], assets: [asset] });
    const post = getPost(postId);
    expect(validatePostLike(post, { now }).find((i) => i.code === 'v_media_host_missing')).toMatchObject({ level: 'error', field: 'mediaHost' });
    updateTarget(post.targets[0].id, { state: 'queued', nextAttemptAt: now });
    const w = createWorker({
      now: () => now, setTimer: () => 0, clearTimer: () => {}, emit: () => {}, on: null, isDemo: () => false,
      makeContext: () => createPublishContext({ now: () => now }), tokenFingerprint: () => 'fp',
      notifier: { published: async () => true, failed: async () => true, missed: async () => true, authPaused: async () => true, quota: async () => true },
    });
    await w.tick();
    await w.idle();
    expect(getTarget(post.targets[0].id)).toMatchObject({ state: 'failed', lastErrorCode: 'pub_host_missing' });
    expect(world.find('POST', `/${TH_ID}/threads`)).toHaveLength(0);
  });
});
