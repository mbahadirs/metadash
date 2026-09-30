import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { createWorkerApp } from '../worker/src/server.js';
import { clientKeyFor, isPrivateIp, normalizeIp } from '../worker/src/clientip.js';
import { tmpDir, DATA_KEY } from './worker.fixtures.js';
import { generateSecret, deriveKey, signedHeaders } from '../src/shared/publish/protocol.js';

describe('worker client address (clientKeyFor)', () => {
  it('classifies private, loopback and public addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.18.0.3', '192.168.1.9', '169.254.1.1', '100.100.1.1', '::1', 'fd12::1', 'fe80::1', '::ffff:172.18.0.2']) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '2001:4860::8888', 'nonsense', '']) expect(isPrivateIp(ip), ip).toBe(false);
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('[2001:db8::1]')).toBe('2001:db8::1');
    expect(normalizeIp('not-an-ip')).toBeNull();
  });

  it('ignores X-Forwarded-For unless trusting the proxy', () => {
    expect(clientKeyFor({ trustProxy: false, remoteAddress: '172.18.0.3', forwardedFor: '8.8.8.8' })).toBe('172.18.0.3');
  });

  it('ignores X-Forwarded-For when the socket peer is not a private/loopback proxy', () => {
    expect(clientKeyFor({ trustProxy: true, remoteAddress: '203.0.113.7', forwardedFor: '8.8.8.8' })).toBe('203.0.113.7');
  });

  it('takes the right-most untrusted entry (the one the proxy appended), not a spoofed left-most one', () => {
    expect(clientKeyFor({ trustProxy: true, remoteAddress: '172.18.0.3', forwardedFor: '1.1.1.1, 203.0.113.9' })).toBe('203.0.113.9');
    expect(clientKeyFor({ trustProxy: true, remoteAddress: '::ffff:172.18.0.3', forwardedFor: '1.1.1.1, 203.0.113.9, 10.0.0.2' })).toBe('203.0.113.9');
  });

  it('falls back to the right-most entry when every hop is private, and to the socket for garbage', () => {
    expect(clientKeyFor({ trustProxy: true, remoteAddress: '127.0.0.1', forwardedFor: '192.168.1.20' })).toBe('192.168.1.20');
    expect(clientKeyFor({ trustProxy: true, remoteAddress: '127.0.0.1', forwardedFor: 'garbage' })).toBe('127.0.0.1');
    expect(clientKeyFor({ trustProxy: true, remoteAddress: '127.0.0.1', forwardedFor: '' })).toBe('127.0.0.1');
    expect(clientKeyFor({ trustProxy: true, remoteAddress: undefined, forwardedFor: undefined })).toBe('unknown');
  });
});

describe('worker lockout over HTTP', () => {
  const SECRET = generateSecret();
  let app;
  let url;
  let dataDir;

  async function start(opts = {}) {
    dataDir = tmpDir('mdw-rl-');
    app = createWorkerApp({ dataDir, secret: SECRET, dataKey: DATA_KEY, rateLimit: { capacity: 10_000, perMinute: 10_000, maxFailures: 3 }, ...opts });
    const addr = await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${addr.port}`;
  }

  afterEach(async () => {
    await app?.close();
    app = null;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const signed = (path = '/v1/info', secret = SECRET) => signedHeaders(deriveKey(secret, 'auth'), { method: 'GET', path, body: '', now: Date.now() });
  const get = (path, headers = {}) => fetch(`${url}${path}`, { headers });

  describe('without proxy trust', () => {
    beforeEach(() => start());

    it('does not count requests without any X-MD-* header toward the lockout', async () => {
      for (let i = 0; i < 6; i++) expect((await get('/v1/info')).status).toBe(401);
      expect((await get('/v1/info', signed())).status).toBe(200);
    });

    it('locks out after repeated signature-bearing failures, but /v1/health keeps answering', async () => {
      const wrong = generateSecret();
      for (let i = 0; i < 3; i++) expect((await get('/v1/info', signed('/v1/info', wrong))).status).toBe(401);
      const locked = await get('/v1/info', signed());
      expect(locked.status).toBe(429);
      expect((await locked.json()).error.code).toBe('locked_out');
      const health = await get('/v1/health');
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true });
    });
  });

  describe('behind a trusted reverse proxy (MD_TRUST_PROXY=1)', () => {
    beforeEach(() => start({ trustProxy: true }));

    it('locks out only the attacking client, not every client of the proxy', async () => {
      const wrong = generateSecret();
      for (let i = 0; i < 3; i++) await get('/v1/info', { ...signed('/v1/info', wrong), 'x-forwarded-for': '203.0.113.66' });
      expect((await get('/v1/info', { ...signed(), 'x-forwarded-for': '203.0.113.66' })).status).toBe(429);
      expect((await get('/v1/info', { ...signed(), 'x-forwarded-for': '198.51.100.10' })).status).toBe(200);
    });

    it('cannot be evaded by prepending a spoofed X-Forwarded-For entry', async () => {
      const wrong = generateSecret();
      for (let i = 0; i < 3; i++) await get('/v1/info', { ...signed('/v1/info', wrong), 'x-forwarded-for': `10.9.9.${i}, 203.0.113.66` });
      expect((await get('/v1/info', { ...signed(), 'x-forwarded-for': '1.2.3.4, 203.0.113.66' })).status).toBe(429);
    });
  });
});
