import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getReadiness, registerReadinessValidation, clearReadinessCache } from '../src/main/publishing/readiness.js';
import { createPublishNotifier } from '../src/main/publishing/notify.js';
import { publishReadiness, OPTIONAL_SCOPES } from '../src/main/meta/auth.js';
import { validatePostLike } from '../src/main/planner/validationContext.js';
import { setMediaHostSettings, recordHostTest } from '../src/main/publishing/hosts/index.js';
import { getPost } from '../src/main/db/queries/planner.js';
import { setSetting } from '../src/main/db/queries/settings.js';
import { msg } from '../src/main/i18n.js';
import { PUBLISHING_MESSAGES } from '../src/main/i18n/publishing.js';
import { PLANNER_MESSAGES } from '../src/main/i18n/planner.js';
import { createPublishWorld, setupPublishingDb, ACCOUNTS } from './fixtures/graph/publish.js';

let db;
beforeAll(() => { db = setupPublishingDb('metadash-ready-'); });
afterAll(() => { vi.unstubAllGlobals(); db.cleanup(); });

describe('publish readiness', () => {
  it('meta/auth: publishing scopes are optional and reported separately', () => {
    expect(OPTIONAL_SCOPES).toEqual(expect.arrayContaining(['instagram_content_publish', 'pages_manage_posts', 'pages_manage_engagement']));
    expect(publishReadiness(['instagram_content_publish', 'instagram_manage_comments'])).toEqual({ instagram: true, facebook: false, igFirstComment: true, fbFirstComment: false });
  });

  it('reads scopes + Page tasks, and feeds missing scopes into validation', async () => {
    const world = createPublishWorld({ scopes: ['instagram_basic', 'pages_manage_posts'], pageTasks: ['ANALYZE'] });
    vi.stubGlobal('fetch', vi.fn(world.fetch));
    setMediaHostSettings({ type: 's3', s3: { bucket: 'b', endpoint: 'https://s3.test' }, accessKeyId: 'AKID', secretAccessKey: 'SECRET' });
    recordHostTest({ ok: true });
    clearReadinessCache();
    const r = await getReadiness({ force: true });
    expect(r.instagram).toEqual({ canPublish: false, missingScopes: ['instagram_content_publish', 'instagram_manage_comments'], firstComment: false });
    expect(r.facebook).toMatchObject({ canPublish: true, missingScopes: ['pages_manage_engagement'], firstComment: false });
    expect(r.facebook.pages).toEqual([{ accountId: ACCOUNTS.fb, canPublish: false }]); // no CREATE_CONTENT task
    expect(r.threads).toEqual({ canPublish: true, missingScopes: [], firstComment: true });
    expect(r.mediaHost).toEqual({ type: 's3', configured: true, lastTestOk: true });

    registerReadinessValidation();
    const postId = db.makePost({ scheduledAt: Date.now() + 3_600_000, targets: [{ accountId: ACCOUNTS.ig, platform: 'instagram', format: 'image' }], assets: [db.makeAsset()] });
    const issue = validatePostLike(getPost(postId)).find((i) => i.code === 'v_missing_scope');
    expect(issue).toMatchObject({ level: 'error', params: { scopes: 'instagram_content_publish' } });
  });

  it('demo mode is always ready', async () => {
    setSetting('demoMode', true);
    const r = await getReadiness();
    expect(r.instagram.canPublish && r.facebook.canPublish && r.threads.canPublish).toBe(true);
    setSetting('demoMode', false);
  });
});

describe('publish notifications', () => {
  it('respects notify prefs and demo mode, dedupes auth/quota warnings, routes to the planner', async () => {
    const shown = [];
    const prefs = { 'notify.enabled': true, 'notify.publishSuccess': false, 'notify.publishFailure': true };
    const n = createPublishNotifier({ show: (note) => { shown.push(note); return true; }, config: (k) => prefs[k], isDemo: () => false, now: () => 1 });
    const post = { id: 7, ref: 'P-0007' };
    const target = { accountId: ACCOUNTS.ig, platform: 'instagram' };
    await n.published({ post, target, account: { username: 'brand' } });
    await n.failed({ post, target, account: { username: 'brand' }, message: 'boom' });
    await n.missed(3);
    await n.authPaused('meta');
    await n.authPaused('meta');
    expect(shown.map((s) => s.route)).toEqual(['/planner?tab=queue&post=7', '/planner?tab=queue&missed=1', '/settings']);
    expect(shown[0].body).toContain('P-0007');
    expect(shown[0].body).toContain('@brand');
    const demo = createPublishNotifier({ show: (note) => { shown.push(note); return true; }, config: () => true, isDemo: () => true });
    expect(await demo.failed({ post, target, message: 'x' })).toBe(false);
  });

  it('every publishing i18n key has en + tr and does not collide with planner keys', () => {
    for (const [k, v] of Object.entries(PUBLISHING_MESSAGES)) {
      expect(v).toHaveLength(2);
      expect(PLANNER_MESSAGES[k]).toBeUndefined();
    }
    expect(msg('pub_missed', { min: 20 }, 'tr')).toContain('20 dk');
  });
});
