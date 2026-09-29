/**
 * v2.0 chunk B sync foundation: cross-process sync lease, tokenForAccount for multi-profile auths, derived daily
 * series, the periodic-task registry, the report-section and notification-rule hooks.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb, q } from '../src/main/db/index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-b20-'));
let m;
beforeAll(async () => {
  openDb(path.join(dir, 'data.db'));
  m = {
    orch: await import('../src/main/sync/orchestrator.js'),
    locks: await import('../src/main/db/queries/locks.js'),
    profiles: await import('../src/main/db/queries/profiles.js'),
    accounts: await import('../src/main/db/queries/accounts.js'),
    media: await import('../src/main/db/queries/media.js'),
    derived: await import('../src/main/analytics/derived.js'),
    scheduler: await import('../src/main/sync/scheduler.js'),
    periodic: await import('../src/main/sync/periodic.js'),
    sections: await import('../src/main/export/reportSections/index.js'),
    notify: await import('../src/main/notifyRules.js'),
    store: await import('../src/main/config/store.js'),
  };
});
afterAll(() => { m.scheduler.stopScheduler(); closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('sync lease', () => {
  it('refuses to start while another process holds the lease and reports it in syncStatus', async () => {
    m.profiles.upsertProfile({ label: 'Meta', appId: '1', tokenRef: 'demo' });
    expect(m.locks.acquireLease(m.orch.SYNC_LEASE, `cli:${process.pid}:${os.hostname()}:other`, { ttlMs: 60_000 })).toBe(true);
    await expect(m.orch.runSync({ scope: 'organic' })).rejects.toMatchObject({ message: 'SYNC_LOCKED', holder: { kind: 'cli' } });
    expect(m.orch.syncStatus().lockedBy).toMatchObject({ kind: 'cli' });
    m.locks.releaseLease(m.orch.SYNC_LEASE, `cli:${process.pid}:${os.hostname()}:other`);
    expect(m.orch.syncStatus().lockedBy).toBeNull();
  });

  it('takes and releases the lease around a (demo) run', async () => {
    const { progressBus } = await import('../src/main/sync/progress.js');
    const done = new Promise((resolve) => progressBus.once('sync:done', resolve));
    await m.orch.runSync({ scope: 'stories' });
    await done;
    expect(m.locks.leaseHolder(m.orch.SYNC_LEASE)).toBeNull();
  });

  it('builds profiles per auth from the registry', () => {
    const p = m.orch.profilesByAuth();
    expect(Object.keys(p)).toEqual(['meta', 'threads', 'google', 'tiktok']);
    expect(Array.isArray(p.google)).toBe(true);
    expect(p.threads).toBeNull();
  });
});

describe('tokenForAccount', () => {
  const youtube = { platform: 'youtube', auth: 'google', refreshToken: vi.fn(async () => ({ token: 'FRESH', expiresAt: Date.now() + 3_600_000 })) };
  const providerOf = (p) => (p === 'youtube' ? youtube : { platform: p, auth: p === 'threads' ? 'threads' : 'meta' });

  it('single-profile auths delegate to tokenFor', async () => {
    const resolve = m.orch.createAccountTokenResolver({ tokenFor: (auth) => `T:${auth}`, providerOf });
    await expect(resolve({ platform: 'instagram' })).resolves.toBe('T:meta');
    await expect(resolve({ platform: 'threads' })).resolves.toBe('T:threads');
  });

  it('multi-profile auths read the account profile and refresh near expiry (once per run)', async () => {
    const now = Date.now();
    const fresh = m.profiles.upsertExternalProfile({ platform: 'google', externalId: 'UCa', label: 'A', appId: 'c', tokenRef: m.store.storeToken('google:UCa', 'TOKEN_A'), tokenExpiresAt: now + 3_600_000 });
    const stale = m.profiles.upsertExternalProfile({ platform: 'google', externalId: 'UCb', label: 'B', appId: 'c', tokenRef: m.store.storeToken('google:UCb', 'OLD_B'), tokenExpiresAt: now + 60_000 });
    const resolve = m.orch.createAccountTokenResolver({ tokenFor: () => { throw new Error('unused'); }, providerOf, now: () => now });
    await expect(resolve({ platform: 'youtube', profileId: fresh })).resolves.toBe('TOKEN_A');
    await expect(Promise.all([resolve({ platform: 'youtube', profileId: stale }), resolve({ platform: 'youtube', profileId: stale })])).resolves.toEqual(['FRESH', 'FRESH']);
    expect(youtube.refreshToken).toHaveBeenCalledTimes(1);
    await expect(resolve({ platform: 'youtube', profileId: 999 })).rejects.toMatchObject({ code: 190, source: 'google' });
    m.profiles.deactivateProfile(fresh);
    const again = m.orch.createAccountTokenResolver({ tokenFor: () => 'x', providerOf, now: () => now });
    await expect(again({ platform: 'youtube', profileId: fresh })).rejects.toMatchObject({ code: 190 });
  });
});

describe('derived daily series', () => {
  it('estimates new followers and views from snapshots', () => {
    const day = (d, h = 12) => new Date(2026, 8, d, h).getTime();
    m.accounts.upsertAccount({ igId: 'tt-1', platform: 'tiktok', externalId: '1', profileId: 1, username: 'tok' });
    for (const [d, f] of [[1, 100], [2, 110], [4, 105]]) m.accounts.insertSnapshot({ igId: 'tt-1', date: `2026-09-0${d}`, followers: f, follows: 0, mediaCount: 1, capturedAt: day(d) });
    const base = { igId: 'tt-1', mediaType: 'VIDEO', mediaProductType: 'TIKTOK', postedHour: 0, postedWeekday: 0 };
    m.media.upsertMedia({ ...base, mediaId: 'tt-new', postedAt: day(1, 1) });
    m.media.upsertMedia({ ...base, mediaId: 'tt-old', postedAt: day(1, 1) - 30 * 86_400_000 });
    const snap = (id, d, h, v) => m.media.insertSnapshotMetric(id, day(d, h), 0, 'views', v);
    snap('tt-new', 1, 10, 50); snap('tt-new', 1, 20, 80); snap('tt-new', 2, 10, 200);
    snap('tt-old', 1, 10, 5000); snap('tt-old', 2, 10, 5100); snap('tt-old', 3, 10, 5100);
    expect(m.derived.derivedFollowerSeries('tt-1')).toEqual([{ date: '2026-09-02', value: 10 }, { date: '2026-09-04', value: -5 }]);
    expect(m.derived.derivedViewsSeries('tt-1')).toEqual([{ date: '2026-09-01', value: 80 }, { date: '2026-09-02', value: 220 }]);
    expect(m.derived.materializeDerivedSeries('tt-1')).toBe(4);
    expect(q.get("SELECT value FROM account_insights_daily WHERE ig_id = 'tt-1' AND date = '2026-09-02' AND metric = 'views'").value).toBe(220);
  });
});

describe('extension hooks', () => {
  it('periodic modules are stubs today and registerPeriodic runs without overlap', async () => {
    expect(await m.periodic.loadPeriodicTasks()).toEqual([]);
    vi.useFakeTimers();
    let runs = 0;
    let release;
    m.scheduler.registerPeriodic({ id: 't', intervalMs: 1000, run: () => { runs += 1; return new Promise((r) => { release = r; }); } });
    await vi.advanceTimersByTimeAsync(3500);
    expect(runs).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(2);
    expect(m.scheduler.periodicIds()).toEqual(['t']);
    m.scheduler.unregisterPeriodic('t');
    vi.useRealTimers();
    expect(() => m.scheduler.registerPeriodic({ id: 'x' })).toThrow();
  });

  it('report sections and notification rules are empty until the feature chunks land', () => {
    expect(m.sections.allReportSections()).toEqual([]);
    expect(m.sections.extraSectionsFor('monthly', 'instagram')).toEqual([]);
    expect(m.notify.EXTRA_RULES).toEqual([]);
    expect(m.notify.NOTIFY_TYPES).toEqual(['anomalies', 'budget', 'silent', 'token']);
  });
});
