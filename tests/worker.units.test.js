import { describe, it, expect } from 'vitest';
import { rule } from '../src/main/notifyRules/worker.js';
import { command } from '../src/main/cli/commands/worker.js';
import { invalidReason } from '../worker/src/items.js';
import { broaderScopes, missingScopes } from '../src/shared/publish/scopes.js';
import { generatePairing, resolveConfigureInput } from '../src/main/worker/pairing.js';
import { decodePairing } from '../src/shared/publish/protocol.js';
import { igItem } from './worker.fixtures.js';

const NOW = Date.UTC(2026, 9, 1);
const ctx = { now: NOW, lang: 'en', sent: {}, wasSent: (sent, key) => !!sent[key], nameList: (n) => n.join(', '), cooldownMs: 86_400_000 };

describe('worker notification rule', () => {
  it('reports failed/missed worker items first, then an unreachable worker, then tokens', () => {
    const base = { enabled: true, lastSyncAt: NOW - 60_000, lastError: null, waiting: 0, failures: [], tokens: [] };
    expect(rule.pick({ worker: { ...base, enabled: false, failures: [{ id: 1, status: 'failed' }] } }, ctx)).toBeNull();
    const failed = rule.pick({ worker: { ...base, failures: [{ id: 1, status: 'failed', ref: 'P-0001', username: 'brand' }] } }, ctx);
    expect(failed).toMatchObject({ type: 'worker', key: 'worker:failed:1', route: '/planner' });
    expect(failed.body).toContain('P-0001 @brand');
    expect(rule.pick({ worker: { ...base, failures: [{ id: 1, status: 'failed' }] } }, { ...ctx, sent: { 'worker:failed:1': 'x' } })).toBeNull();
    const offline = rule.pick({ worker: { ...base, waiting: 2, lastError: 'offline', lastSyncAt: NOW - 7 * 3_600_000 } }, ctx);
    expect(offline).toMatchObject({ route: '/settings' });
    const tokens = rule.pick({ worker: { ...base, tokens: [{ tokenKey: 'threads:th-1', status: 'ok', expiresAt: NOW + 86_400_000 }] } }, ctx);
    expect(tokens.body).toContain('threads:th-1');
  });
});

describe('worker CLI command', () => {
  const out = () => { const lines = { result: [], error: [], warn: [] }; return { lines, out: { json: true, result: (d) => lines.result.push(d), error: (l) => lines.error.push(l), warn: (l) => lines.warn.push(l), info() {} } }; };
  const state = (over = {}) => ({ configured: true, enabled: true, url: 'https://w', defaultExecutor: 'local', lastSyncAt: 1, lastError: null, info: { version: '2.0.0', queue: { queued: 1, publishing: 0, failed: 0 }, publicMediaUrl: true }, tokens: [{ tokenKey: 'instagram:1', platform: 'instagram', status: 'ok', expiresAt: null, scopes: [] }], ...over });

  it('status prints a summary without secrets', async () => {
    const o = out();
    expect(await command.run({}, { ...o, positionals: ['status'], services: { workerState: () => state() } })).toBe(0);
    expect(JSON.stringify(o.lines.result)).not.toMatch(/secret/i);
    expect(o.lines.result[0]).toMatchObject({ configured: true, version: '2.0.0', tokens: [{ tokenKey: 'instagram:1' }] });
  });

  it('sync returns PARTIAL when items failed, usage errors are exit 2, unconfigured is exit 1', async () => {
    const o = out();
    expect(await command.run({}, { ...o, positionals: ['sync'], services: { workerState: () => state(), syncNow: async () => ({ pushed: 1, pulled: 0, errors: [{ targetId: 1 }] }) } })).toBe(3);
    expect(await command.run({}, { ...o, positionals: ['nope'], services: { workerState: () => state() } })).toBe(2);
    expect(await command.run({}, { ...o, positionals: ['sync'], services: { workerState: () => state({ configured: false }) } })).toBe(1);
  });
});

describe('worker item validation and scopes', () => {
  it('rejects malformed items', () => {
    expect(invalidReason(igItem())).toBeNull();
    expect(invalidReason({ ...igItem(), id: 'x' })).toBe('invalid_id');
    expect(invalidReason({ ...igItem(), platform: 'youtube' })).toBe('invalid_platform');
    expect(invalidReason({ ...igItem(), tokenKey: 'threads:1' })).toBe('invalid_token_key');
    expect(invalidReason({ ...igItem(), payload: { ...igItem().payload, media: [{ url: 'http://insecure/x.jpg', kind: 'image' }] } })).toBe('invalid_media');
    expect(invalidReason({ ...igItem(), payload: { ...igItem().payload, externalId: '../x' } })).toBe('invalid_payload');
  });

  it('flags scopes beyond publishing and missing publishing scopes', () => {
    expect(broaderScopes('instagram', ['instagram_basic', 'instagram_content_publish', 'ads_read', 'instagram_manage_insights'])).toEqual(['ads_read', 'instagram_manage_insights']);
    expect(broaderScopes('threads', ['threads_basic', 'threads_content_publish', 'threads_manage_insights'])).toEqual(['threads_manage_insights']);
    expect(missingScopes('facebook', ['pages_show_list'])).toEqual(['pages_manage_posts']);
  });

  it('generates pairing material and resolves configure input', () => {
    const p = generatePairing({ url: 'https://w.example' });
    expect(p.envSnippet).toContain(`MD_WORKER_SECRET=${p.secret}`);
    expect(p.envSnippet).toMatch(/MD_WORKER_DATA_KEY=\S{32,}/);
    expect(decodePairing(p.pairing)).toEqual({ url: 'https://w.example', secret: p.secret });
    expect(resolveConfigureInput({ pairing: p.pairing })).toEqual({ url: 'https://w.example', secret: p.secret });
    expect(() => resolveConfigureInput({ url: 'https://x', secret: 'short' })).toThrow(expect.objectContaining({ code: 'NO_SECRET' }));
  });
});
