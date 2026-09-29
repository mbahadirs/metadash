/**
 * v2.0 migrations 011–014 on a database that was at schema v10 (v1.5), incl. the 012 backfill from the v1.5 Studio
 * inbox, plus the chunk-B query changes (multi-profile profiles, leases, quota ledger, comments v2 columns, media).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb, closeDb, q } from '../src/main/db/index.js';
import { upsertExternalProfile, activeProfiles, getProfileById, profileScopes, listProfiles, upsertProfile, deactivateProfile } from '../src/main/db/queries/profiles.js';
import { acquireLease, renewLease, releaseLease, leaseHolder, withLease } from '../src/main/db/queries/locks.js';
import { addQuotaUnits, quotaUsed, pruneQuota } from '../src/main/db/queries/quota.js';
import { upsertComment, upsertMedia, upsertLatest, getMedia, mediaTypeKey, listMedia } from '../src/main/db/queries/media.js';
import { storeComments } from '../src/main/db/queries/comments.js';

const MIGRATIONS = path.join(import.meta.dirname, '../src/main/db/migrations');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-m011-'));
const file = path.join(dir, 'data.db');
const cols = (table) => q.all(`PRAGMA table_info(${table})`).map((c) => c.name);

/** A v10 database as v1.5 left it: IG + Threads accounts, comments, Studio reply records, notes, a planner target. */
function buildV10() {
  const db = new Database(file);
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER)');
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => /^\d+_.*\.sql$/.test(x)).sort()) {
    const version = Number.parseInt(f, 10);
    if (version > 10) continue;
    db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(version, Date.now());
  }
  db.prepare("INSERT INTO profiles (label, app_id, token_ref, created_at, is_active) VALUES ('Meta', '1', 'token:p', 1, 1)").run();
  db.prepare("INSERT INTO accounts (ig_id, profile_id, username, is_tracked, platform, external_id) VALUES ('1784', 1, 'ig', 1, 'instagram', '1784'), ('th-9', 1, 'th', 1, 'threads', '9')").run();
  db.prepare("INSERT INTO media (media_id, ig_id, media_type, media_product_type, posted_at, is_deleted) VALUES ('m1', '1784', 'IMAGE', 'FEED', 1, 0), ('th-5', 'th-9', 'TEXT_POST', 'THREADS', 1, 0)").run();
  const c = db.prepare('INSERT INTO comments (comment_id, media_id, username, text, created_at, is_from_owner, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  c.run('c1', 'm1', 'fan', 'hi?', 1000, 0, null);
  c.run('c2', 'm1', 'fan2', 'nice', 2000, 0, null);
  c.run('c3', 'th-5', 'x', 'yo', 3000, 0, null);
  db.prepare("INSERT INTO comment_replies (comment_id, suggestion, status, created_at) VALUES ('c1', '', 'dismissed', 5000)").run();
  db.prepare("INSERT INTO comment_replies (comment_id, suggestion, status, sent_text, sent_at, created_at) VALUES ('c2', 'thanks', 'sent', 'thanks', 6000, 5500)").run();
  db.prepare("INSERT INTO notes (entity_type, entity_id, body, created_at) VALUES ('account', '1784', 'n1', 1), ('account', '1784', 'n2', 2)").run();
  db.prepare("INSERT INTO planner_posts (id, caption, status, created_at, updated_at) VALUES (1, 'x', 'draft', 1, 1)").run();
  db.prepare("INSERT INTO planner_targets (post_id, account_id, platform, format) VALUES (1, '1784', 'instagram', 'image')").run();
  db.close();
}

beforeAll(() => { buildV10(); openDb(file); });
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('migrations 011–014 on a v10 database', () => {
  it('records every version and sets busy_timeout', () => {
    expect(q.all('SELECT version FROM schema_version WHERE version BETWEEN 11 AND 14 ORDER BY version').map((r) => r.version)).toEqual([11, 12, 13, 14]);
    expect(q.get('PRAGMA busy_timeout').timeout).toBeGreaterThanOrEqual(5000);
  });

  it('011: media/media_latest/profiles columns, api_quota, locks', () => {
    expect(cols('media')).toContain('duration_s');
    expect(cols('media_latest')).toEqual(expect.arrayContaining(['watch_time_min', 'avg_view_duration_s', 'avg_view_pct']));
    expect(cols('profiles')).toEqual(expect.arrayContaining(['external_id', 'scopes', 'refresh_ref']));
    expect(cols('api_quota')).toEqual(['provider', 'day', 'units']);
    expect(cols('locks')).toEqual(['name', 'owner', 'pid', 'acquired_at', 'expires_at']);
  });

  it('012: backfills platform/account of existing comments and inbox_state from v1.5 reply records', () => {
    expect(q.get("SELECT platform, account_id, external_id FROM comments WHERE comment_id = 'c1'")).toEqual({ platform: 'instagram', account_id: '1784', external_id: 'c1' });
    expect(q.get("SELECT platform, account_id FROM comments WHERE comment_id = 'c3'")).toEqual({ platform: 'threads', account_id: 'th-9' });
    expect(q.get("SELECT status, status_at FROM inbox_state WHERE comment_id = 'c1'")).toEqual({ status: 'done', status_at: 5000 });
    expect(q.get("SELECT status, first_response_at, first_response_source FROM inbox_state WHERE comment_id = 'c2'")).toEqual({ status: 'replied', first_response_at: 6000, first_response_source: 'app' });
    expect(q.get("SELECT COUNT(*) AS n FROM inbox_state WHERE comment_id = 'c3'").n).toBe(0);
    expect(cols('comment_replies')).toEqual(expect.arrayContaining(['platform', 'account_id', 'attempts', 'error_code', 'author', 'sending_at']));
    expect(cols('inbox_cursor')).toEqual(['account_id', 'media_id', 'last_polled_at', 'last_comment_count']);
    // inbox_state rows cascade with their comment
    q.run("DELETE FROM comment_replies WHERE comment_id = 'c1'");
    q.run("DELETE FROM comments WHERE comment_id = 'c1'");
    expect(q.get("SELECT COUNT(*) AS n FROM inbox_state WHERE comment_id = 'c1'").n).toBe(0);
  });

  it('013: notes get unique uids and team tables exist', () => {
    const uids = q.all('SELECT uid, visibility, origin FROM notes');
    expect(uids).toHaveLength(2);
    expect(new Set(uids.map((u) => u.uid)).size).toBe(2);
    expect(uids.every((u) => /^[0-9a-f]{32}$/.test(u.uid) && u.visibility === 'internal' && u.origin === 'local')).toBe(true);
    for (const t of ['team_members', 'team_events_applied', 'mention_seen']) expect(q.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", t)).toBeTruthy();
  });

  it('014: planner targets default to the local executor', () => {
    expect(q.get('SELECT executor, revision, worker_revision FROM planner_targets')).toEqual({ executor: 'local', revision: 0, worker_revision: null });
    expect(cols('worker_tokens')).toEqual(['token_key', 'platform', 'account_id', 'scopes', 'expires_at', 'pushed_at', 'status']);
  });
});

describe('chunk B queries', () => {
  it('multi-profile auths keep one active row per external id', () => {
    const a = upsertExternalProfile({ platform: 'google', externalId: 'UC1', label: 'Chan 1', appId: 'cid', tokenRef: 'token:google:UC1', tokenExpiresAt: 10, refreshRef: 'token:google-refresh:UC1', scopes: ['youtube.readonly'] });
    const b = upsertExternalProfile({ platform: 'google', externalId: 'UC2', label: 'Chan 2', appId: 'cid', tokenRef: 'token:google:UC2' });
    expect(activeProfiles('google').map((p) => p.id)).toEqual([a, b]);
    expect(upsertExternalProfile({ platform: 'google', externalId: 'UC1', label: 'Chan 1b', appId: 'cid', tokenRef: 'token:google:UC1', tokenExpiresAt: 20 })).toBe(a);
    const p = getProfileById(a);
    expect(p).toMatchObject({ label: 'Chan 1b', token_expires_at: 20, refresh_ref: 'token:google-refresh:UC1', is_active: 1 });
    expect(profileScopes(p)).toEqual(['youtube.readonly']);
    deactivateProfile(b);
    expect(activeProfiles('google').map((x) => x.id)).toEqual([a]);
    // single-profile auths are unchanged (upsertProfile deactivates only its own platform)
    upsertProfile({ label: 'Meta 2', appId: '2', tokenRef: 'token:m2' });
    expect(activeProfiles('google')).toHaveLength(1);
    expect(listProfiles('meta').length).toBeGreaterThanOrEqual(2);
  });

  it('leases: exclusive, renewable, expiring, releasable', async () => {
    expect(acquireLease('sync', 'gui:1:h:a', { ttlMs: 1000, now: 0 })).toBe(true);
    expect(acquireLease('sync', 'cli:2:h:b', { ttlMs: 1000, now: 500 })).toBe(false);
    expect(leaseHolder('sync', { now: 500 })).toMatchObject({ owner: 'gui:1:h:a', kind: 'gui' });
    expect(renewLease('sync', 'gui:1:h:a', { ttlMs: 1000, now: 900 })).toBe(true);
    expect(acquireLease('sync', 'cli:2:h:b', { ttlMs: 1000, now: 1500 })).toBe(false);
    expect(acquireLease('sync', 'cli:2:h:b', { ttlMs: 1000, now: 2000 })).toBe(true); // expired → taken over
    expect(releaseLease('sync', 'gui:1:h:a')).toBe(false);
    expect(releaseLease('sync', 'cli:2:h:b')).toBe(true);
    expect(leaseHolder('sync')).toBeNull();
    await expect(withLease('x', 'a:1:h:1', async () => {
      await expect(withLease('x', 'b:1:h:2', async () => 1)).rejects.toMatchObject({ code: 'LEASE_BUSY' });
      return 7;
    })).resolves.toBe(7);
    expect(leaseHolder('x')).toBeNull();
  });

  it('quota ledger adds units per provider/day', () => {
    expect(addQuotaUnits('youtube:abc', '2026-09-30', 3)).toBe(3);
    expect(addQuotaUnits('youtube:abc', '2026-09-30', 50)).toBe(53);
    expect(quotaUsed('youtube:abc', '2026-10-01')).toBe(0);
    pruneQuota('2026-10-01');
    expect(quotaUsed('youtube:abc', '2026-09-30')).toBe(0);
  });

  it('comments: v1.5 storeComments fills the v2.0 columns; hidden flag survives re-sync', () => {
    storeComments('th-5', [{ id: 'c9', text: 't', timestamp: new Date(10_000).toISOString(), like_count: 0, username: 'u' }], 'th');
    expect(q.get("SELECT platform, account_id, external_id, is_hidden FROM comments WHERE comment_id = 'c9'")).toEqual({ platform: 'threads', account_id: 'th-9', external_id: 'c9', is_hidden: 0 });
    upsertComment({ commentId: 'c9', mediaId: 'th-5', username: 'u', text: 't', createdAt: 10_000, isHidden: true, fetchedAt: 11 });
    storeComments('th-5', [{ id: 'c9', text: 't2', timestamp: new Date(10_000).toISOString(), like_count: 1, username: 'u' }], 'th');
    expect(q.get("SELECT is_hidden, text, fetched_at FROM comments WHERE comment_id = 'c9'")).toEqual({ is_hidden: 1, text: 't2', fetched_at: 11 });
  });

  it('media: duration and watch metrics; YouTube/TikTok type keys', () => {
    q.run("INSERT INTO accounts (ig_id, profile_id, username, is_tracked, platform, external_id) VALUES ('yt-UC1', 1, 'chan', 1, 'youtube', 'UC1')");
    const base = { igId: 'yt-UC1', mediaType: 'VIDEO', postedAt: 5, postedHour: 0, postedWeekday: 0 };
    upsertMedia({ ...base, mediaId: 'yt-a', mediaProductType: 'YT_SHORT', durationS: 42 });
    upsertMedia({ ...base, mediaId: 'yt-b', mediaProductType: 'YT_VIDEO', durationS: 600 });
    upsertMedia({ ...base, mediaId: 'yt-c', mediaProductType: 'YT_LIVE' });
    upsertLatest('yt-b', { views: 100, watch_time_min: 250.5, avg_view_duration_s: 150, avg_view_pct: 25 }, null);
    expect(getMedia('yt-b')).toMatchObject({ durationS: 600, watchTimeMin: 250.5, avgViewDurationS: 150, avgViewPct: 25, views: 100 });
    expect(['yt-a', 'yt-b', 'yt-c'].map((id) => mediaTypeKey(getMedia(id)))).toEqual(['short', 'video', 'live']);
    expect(mediaTypeKey({ mediaProductType: 'TIKTOK', mediaType: 'VIDEO' })).toBe('video');
    expect(listMedia({ igIds: ['yt-UC1'], typeKeys: ['video'] }).map((m) => m.mediaId)).toEqual(['yt-b']);
    expect(listMedia({ igIds: ['yt-UC1'], typeKeys: ['short', 'live'] }).map((m) => m.mediaId).sort()).toEqual(['yt-a', 'yt-c']);
  });
});
