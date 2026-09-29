/**
 * Migration 008 (multi-platform) on a database that was at schema v7, plus the platform-scoped query changes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb, closeDb, q } from '../src/main/db/index.js';
import { listAccounts, getAccount, upsertAccount, setTrackedAccounts } from '../src/main/db/queries/accounts.js';
import { getActiveProfile, upsertProfile, updateProfileToken, deactivateProfiles } from '../src/main/db/queries/profiles.js';
import { listMedia, getMedia, upsertMedia, upsertLatest, mediaTypeKey } from '../src/main/db/queries/media.js';
import { logError, recentErrors, listDisabledMetrics, disableMetric, enableMetric, markUnsupported, resolveMetric, getMetricResolution, listMetricResolution } from '../src/main/db/queries/sync.js';

const MIGRATIONS = path.join(import.meta.dirname, '../src/main/db/migrations');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-m008-'));
const file = path.join(dir, 'data.db');

/** Builds a v7 database the way 1.2.0 left it, with legacy Instagram data. */
function buildV7() {
  const db = new Database(file);
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER)');
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const version = Number.parseInt(f, 10);
    if (version > 7) continue;
    db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(version, Date.now());
  }
  db.prepare("INSERT INTO profiles (label, app_id, token_ref, token_expires_at, created_at, is_active) VALUES ('Meta', '123', 'token:profile:123', 1, 1, 1)").run();
  const acc = db.prepare('INSERT INTO accounts (ig_id, profile_id, username, is_tracked, first_seen_at) VALUES (?, 1, ?, ?, 1)');
  acc.run('1784001', 'ig_one', 1);
  acc.run('1784002', 'ig_two', 0);
  db.prepare("INSERT INTO media (media_id, ig_id, media_type, media_product_type, posted_at, is_deleted) VALUES ('m1', '1784001', 'IMAGE', 'FEED', ?, 0)").run(Date.now());
  db.prepare("INSERT INTO media_latest (media_id, reach, likes, comments, saved, shares) VALUES ('m1', 100, 10, 2, 3, 1)").run();
  db.prepare("INSERT INTO sync_runs (id, started_at, scope, status) VALUES (1, 1, 'full', 'ok')").run();
  db.prepare("INSERT INTO sync_errors (run_id, ig_id, endpoint, code, message, at) VALUES (1, '1784001', '/x', 100, 'old', 1)").run();
  db.close();
}

beforeAll(() => { buildV7(); openDb(file); });
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('migration 008 on a v7 database', () => {
  it('records version 8 and creates metric_resolution + the platform index', () => {
    expect(q.get('SELECT COUNT(*) AS n FROM schema_version WHERE version = 8').n).toBe(1); // later migrations (009+) apply on top
    expect(q.get("SELECT name FROM sqlite_master WHERE type='table' AND name='metric_resolution'")).toBeTruthy();
    expect(q.get("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_accounts_platform'")).toBeTruthy();
  });

  it('defaults existing rows to Instagram / meta and backfills external ids', () => {
    const a = getAccount('1784001');
    expect(a).toMatchObject({ igId: '1784001', platform: 'instagram', externalId: '1784001', linkedAccountId: null });
    expect(q.get("SELECT external_id FROM media WHERE media_id = 'm1'").external_id).toBe('m1');
    const p = getActiveProfile();
    expect(p).toMatchObject({ platform: 'meta', app_id: '123', refreshed_at: null });
    const cols = q.all('PRAGMA table_info(media_latest)').map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['reposts', 'quotes', 'clicks']));
    expect(q.get('SELECT platform FROM sync_errors').platform).toBeNull();
  });

  it('keeps legacy media rows readable with the new fields', () => {
    const m = getMedia('m1');
    expect(m).toMatchObject({ platform: 'instagram', externalId: 'm1', reach: 100, reposts: null, quotes: null, clicks: null });
  });
});

describe('platform-aware account queries', () => {
  it('inserts accounts per platform and filters by platform', () => {
    upsertAccount({ igId: 'fb-555', platform: 'facebook', externalId: '555', linkedAccountId: '1784001', profileId: 1, username: 'Page', isTracked: true });
    upsertAccount({ igId: 'th-777', platform: 'threads', externalId: '777', profileId: 1, username: 'thr', isTracked: true });
    expect(getAccount('fb-555')).toMatchObject({ platform: 'facebook', externalId: '555', linkedAccountId: '1784001' });
    expect(listAccounts({ platforms: ['facebook'] }).map((a) => a.igId)).toEqual(['fb-555']);
    expect(listAccounts().map((a) => a.igId).sort()).toEqual(['1784001', 'fb-555', 'th-777']);
  });

  it('keeps platform/external id/link when an update omits them', () => {
    upsertAccount({ igId: 'fb-555', profileId: 1, username: 'Page renamed' });
    expect(getAccount('fb-555')).toMatchObject({ username: 'Page renamed', platform: 'facebook', externalId: '555', linkedAccountId: '1784001' });
  });

  it('setTrackedAccounts only touches the given platform (default instagram)', () => {
    setTrackedAccounts(['1784002']);
    expect(getAccount('1784001').isTracked).toBe(false);
    expect(getAccount('1784002').isTracked).toBe(true);
    expect(getAccount('fb-555').isTracked).toBe(true);
    expect(getAccount('th-777').isTracked).toBe(true);
    setTrackedAccounts([], { platform: 'facebook' });
    expect(getAccount('fb-555').isTracked).toBe(false);
    expect(getAccount('1784002').isTracked).toBe(true);
    // an id of another platform is ignored
    setTrackedAccounts(['1784001'], { platform: 'threads' });
    expect(getAccount('1784001').isTracked).toBe(false);
    expect(getAccount('th-777').isTracked).toBe(false);
    setTrackedAccounts(['1784001', '1784002']);
    setTrackedAccounts(['th-777'], { platform: 'threads' });
  });
});

describe('platform-scoped profiles', () => {
  it('a Threads profile does not deactivate the Meta profile and vice versa', () => {
    const metaBefore = getActiveProfile('meta');
    const threadsId = upsertProfile({ label: 'Threads', appId: '999', tokenRef: 'token:threads:999', tokenExpiresAt: 5, platform: 'threads', refreshedAt: 7 });
    expect(getActiveProfile('meta').id).toBe(metaBefore.id);
    expect(getActiveProfile('threads')).toMatchObject({ id: threadsId, platform: 'threads', refreshed_at: 7 });
    const metaNew = upsertProfile({ label: 'Meta 2', appId: '124', tokenRef: 'token:profile:124' });
    expect(getActiveProfile().id).toBe(metaNew);
    expect(getActiveProfile('threads').id).toBe(threadsId);
    updateProfileToken(threadsId, 'token:threads:999', 50, 60);
    expect(getActiveProfile('threads')).toMatchObject({ token_expires_at: 50, refreshed_at: 60 });
    updateProfileToken(threadsId, 'token:threads:999', 51);
    expect(getActiveProfile('threads').refreshed_at).toBe(60);
    deactivateProfiles('threads');
    expect(getActiveProfile('threads')).toBeNull();
    expect(getActiveProfile('meta').id).toBe(metaNew);
  });
});

describe('platform-aware media queries', () => {
  it('stores external ids, Threads/FB metric columns and exposes the platform', () => {
    upsertMedia({ mediaId: 'th-1', externalId: '1', igId: 'th-777', mediaType: 'TEXT_POST', mediaProductType: 'THREADS', postedAt: Date.now(), postedHour: 1, postedWeekday: 1 });
    upsertLatest('th-1', { views: 900, likes: 5, comments: 2, reposts: 3, quotes: 1, shares: 4 }, 1.2);
    upsertMedia({ mediaId: '555_1', igId: 'fb-555', mediaType: 'LINK', mediaProductType: 'FB_POST', postedAt: Date.now(), postedHour: 1, postedWeekday: 1 });
    upsertLatest('555_1', { reach: 50, clicks: 7 }, null);
    setTrackedAccounts(['fb-555'], { platform: 'facebook' });
    const th = getMedia('th-1');
    expect(th).toMatchObject({ platform: 'threads', externalId: '1', reposts: 3, quotes: 1, views: 900 });
    expect(getMedia('555_1')).toMatchObject({ platform: 'facebook', externalId: '555_1', clicks: 7 });
    expect(listMedia({ platforms: ['threads'] }).map((m) => m.mediaId)).toEqual(['th-1']);
    expect(listMedia({ typeKeys: ['text'] }).map((m) => m.mediaId).sort()).toEqual(['555_1', 'th-1']);
    expect(listMedia({ typeKeys: ['image'] }).map((m) => m.mediaId)).toEqual(['m1']);
  });

  it('classifies text-only posts', () => {
    expect(mediaTypeKey({ mediaType: 'TEXT_POST', mediaProductType: 'THREADS' })).toBe('text');
    expect(mediaTypeKey({ media_type: 'STATUS', media_product_type: 'FB_POST' })).toBe('text');
    expect(mediaTypeKey({ mediaType: 'IMAGE', mediaProductType: 'FEED' })).toBe('image');
    expect(mediaTypeKey({ mediaType: 'VIDEO', mediaProductType: 'REELS' })).toBe('reels');
  });
});

describe('sync bookkeeping', () => {
  it('logs errors with a platform', () => {
    logError(1, { igId: 'th-777', endpoint: '/me', code: 190, message: 'bad', platform: 'threads' });
    const e = recentErrors(1)[0];
    expect(e).toMatchObject({ igId: 'th-777', platform: 'threads', code: 190 });
    expect(recentErrors(5).find((r) => r.message === 'old').platform).toBe('instagram'); // falls back to the account's platform
  });

  it('lists Instagram disabled metrics and unsupported non-IG metrics together', () => {
    disableMetric('shares', 'media', 'nope');
    markUnsupported('facebook', 'account', 'profile_views', 'gone');
    resolveMetric('facebook', 'account', 'views', 'page_media_view');
    const list = listDisabledMetrics();
    expect(list.map((d) => `${d.platform}:${d.metric}`).sort()).toEqual(['facebook:profile_views', 'instagram:shares']);
    expect(getMetricResolution('facebook', 'account', 'views')).toMatchObject({ apiName: 'page_media_view', status: 'ok' });
    expect(listMetricResolution('facebook')).toHaveLength(2);
    enableMetric('profile_views', { platform: 'facebook', scope: 'account' });
    enableMetric('shares');
    expect(listDisabledMetrics()).toEqual([]);
  });
});
