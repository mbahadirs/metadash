import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { describeWorkerUrl } from '../src/main/worker/urlPolicy.js';
import { configure, inspect, setWorkerServiceDeps } from '../src/main/worker/service.js';
import { encodePairing, generateSecret } from '../src/shared/publish/protocol.js';
import { WORKER_CHANNELS } from '../src/main/ipc/worker.handlers.js';

describe('worker URL policy', () => {
  it('classifies loopback / private targets as local', () => {
    for (const u of ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://[::1]:8787', 'http://192.168.1.20:8787', 'http://10.0.0.5', 'http://172.20.1.1', 'http://100.101.102.103:8787', 'http://nas.local:8787']) {
      expect(describeWorkerUrl(u), u).toMatchObject({ scheme: 'http', local: true, insecure: false });
    }
  });

  it('flags plain http to a public host as insecure, https never', () => {
    expect(describeWorkerUrl('http://worker.example.com:8787/')).toEqual({ url: 'http://worker.example.com:8787', scheme: 'http', host: 'worker.example.com', local: false, insecure: true });
    expect(describeWorkerUrl('http://203.0.113.5')).toMatchObject({ insecure: true });
    expect(describeWorkerUrl('https://worker.example.com')).toMatchObject({ scheme: 'https', local: false, insecure: false });
  });

  it('rejects non-http(s) URLs', () => {
    expect(() => describeWorkerUrl('ftp://x')).toThrow();
    expect(() => describeWorkerUrl('not a url')).toThrow();
  });
});

describe('worker configure / inspect', () => {
  const SECRET = generateSecret();
  const calls = [];
  const fetchImpl = async (u) => { calls.push(String(u)); throw new Error('offline in test'); };

  beforeAll(() => setWorkerServiceDeps({ fetchImpl }));
  afterAll(() => setWorkerServiceDeps({ fetchImpl: globalThis.fetch }));

  it('exposes worker:inspect over IPC', () => {
    expect(WORKER_CHANNELS).toContain('worker:inspect');
  });

  it('inspect decodes a pairing string into the target URL without contacting it or returning the secret', () => {
    const r = inspect({ pairing: encodePairing('http://evil.example.net:8787', SECRET) });
    expect(r).toEqual({ url: 'http://evil.example.net:8787', scheme: 'http', host: 'evil.example.net', local: false, insecure: true });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(calls).toEqual([]);
  });

  it('inspect reports bad pairing strings and URLs with friendly codes', () => {
    expect(() => inspect({ pairing: 'mdw1:!!' })).toThrow(expect.objectContaining({ code: 'BAD_PAIRING' }));
    expect(() => inspect({ url: 'ftp://x', secret: SECRET })).toThrow(expect.objectContaining({ code: 'BAD_URL' }));
  });

  it('refuses a non-local http:// worker unless allowInsecureHttp is passed, before sending anything', async () => {
    calls.length = 0;
    await expect(configure({ pairing: encodePairing('http://worker.example.com:8787', SECRET) })).rejects.toMatchObject({ code: 'INSECURE_HTTP' });
    await expect(configure({ url: 'http://203.0.113.5:8787', secret: SECRET })).rejects.toMatchObject({ code: 'INSECURE_HTTP' });
    expect(calls).toEqual([]);
    await expect(configure({ url: 'http://203.0.113.5:8787', secret: SECRET, allowInsecureHttp: true })).rejects.toMatchObject({ code: 'WORKER_OFFLINE' });
    expect(calls).toEqual(['http://203.0.113.5:8787/v1/health']);
  });

  it('allows https and local http targets without the flag', async () => {
    calls.length = 0;
    await expect(configure({ url: 'https://worker.example.com', secret: SECRET })).rejects.toMatchObject({ code: 'WORKER_OFFLINE' });
    await expect(configure({ url: 'http://192.168.1.20:8787', secret: SECRET })).rejects.toMatchObject({ code: 'WORKER_OFFLINE' });
    expect(calls).toHaveLength(2);
  });
});
