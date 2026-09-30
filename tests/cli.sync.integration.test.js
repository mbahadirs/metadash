/**
 * v2.0 CLI (chunk F2): `metadash sync` through the real orchestrator — demo run, cross-process lease (exit 5),
 * read-only workspace (exit 6), no connection / invalid token against a fake Graph API (exit 4).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { graphError } from './fixtures/fakeFetch.js';

process.env.METADASH_GRAPH_DELAY_MS = '0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-cli-sync-'));
let m;

const sink = () => { const s = { text: '', write(x) { s.text += x; return true; } }; return s; };
const run = async (argv, services) => {
  const stdout = sink();
  const stderr = sink();
  const code = await m.cli.runCli(argv, { stdout, stderr, services });
  return { code, out: stdout.text, err: stderr.text, json: () => JSON.parse(stdout.text) };
};

beforeAll(async () => {
  const db = await import('../src/main/db/index.js');
  db.openDb(path.join(dir, 'data.db'));
  const seed = await import('../src/main/seed/index.js');
  seed.seedDemo({ reset: true });
  m = {
    db,
    cli: await import('../src/main/cli/index.js'),
    locks: await import('../src/main/db/queries/locks.js'),
    orch: await import('../src/main/sync/orchestrator.js'),
    accounts: await import('../src/main/db/queries/accounts.js'),
    profiles: await import('../src/main/db/queries/profiles.js'),
    store: await import('../src/main/config/store.js'),
    sync: await import('../src/main/db/queries/sync.js'),
  };
}, 120_000);
afterAll(() => { vi.unstubAllGlobals(); m.db.closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

const firstIg = () => m.accounts.listAccounts({ platforms: ['instagram'] })[0];

describe('metadash sync (demo data)', () => {
  it('runs a demo sync to completion and prints a JSON summary (exit 0)', async () => {
    const r = await run(['sync', '--scope', 'organic', '--platform', 'ig', '--account', firstIg().igId, '--json']);
    expect(r.code).toBe(0);
    const res = r.json();
    expect(res).toMatchObject({ scope: 'organic', status: 'ok', demo: true, invalidAuth: [], exitCode: 0 });
    expect(m.sync.listRuns(1)[0]).toMatchObject({ id: res.runId, status: 'ok' });
    expect(r.err).toMatch(/\[\d+\/\d+\]/);
    expect(m.locks.leaseHolder(m.orch.SYNC_LEASE)).toBeNull();
  });

  it('human output with --quiet has no progress lines', async () => {
    const r = await run(['sync', '--scope', 'stories', '--quiet']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Sync ok/);
    expect(r.err).toBe('');
  });

  it('exits 5 while the app (or another CLI) holds the sync lease', async () => {
    const gui = `gui:${process.pid}:${os.hostname()}:app`;
    expect(m.locks.acquireLease(m.orch.SYNC_LEASE, gui, { ttlMs: 60_000 })).toBe(true);
    const r = await run(['sync']);
    expect(r.code).toBe(5);
    expect(r.err).toContain('MetaDash app');
    m.locks.releaseLease(m.orch.SYNC_LEASE, gui);

    const cli = `cli:${process.pid}:${os.hostname()}:other`;
    m.locks.acquireLease(m.orch.SYNC_LEASE, cli, { ttlMs: 60_000 });
    const r2 = await run(['sync', '--lang', 'tr']);
    expect(r2.code).toBe(5);
    expect(r2.err).toContain('Başka bir senkronizasyon');
    m.locks.releaseLease(m.orch.SYNC_LEASE, cli);
  });

  it('exits 6 in a read-only (subscriber) workspace and 2 for bad selections', async () => {
    expect((await run(['sync'], { getSession: () => ({ role: 'analyst', readOnly: true, workspace: 't1' }) })).code).toBe(6);
    expect((await run(['sync', '--account', '@nobody-here'])).code).toBe(2);
    expect((await run(['sync', '--platform', 'myspace'])).code).toBe(2);
    expect((await run(['sync', '--client', 'Nope Inc'])).code).toBe(2);
  });

  it('maps a missing connection to exit 4', async () => {
    const r = await run(['sync'], { runSync: async () => { throw new Error('NO_PROFILE'); } });
    expect(r.code).toBe(4);
  });
});

describe('metadash sync (real API path, fake Graph)', () => {
  it('exits 4 and names the connection when the Meta token is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => graphError(190, 'Error validating access token')));
    m.profiles.deactivateProfiles('meta');
    const ref = m.store.storeToken('profile:cli-test', 'REAL_TOKEN');
    m.profiles.upsertProfile({ label: 'Real', appId: '42', tokenRef: ref, tokenExpiresAt: Date.now() + 30 * 86_400_000 });
    const r = await run(['sync', '--scope', 'organic', '--platform', 'instagram', '--account', firstIg().igId, '--json']);
    expect(r.code).toBe(4);
    const res = r.json();
    expect(res.demo).toBe(false);
    expect(res.invalidAuth).toContain('meta');
    expect(r.out).not.toContain('REAL_TOKEN');
    expect(m.locks.leaseHolder(m.orch.SYNC_LEASE)).toBeNull();
  });
});
