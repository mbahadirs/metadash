import { describe, it, expect, vi, afterEach } from 'vitest';
import { createGraphClient } from '../src/main/meta/client.js';
import { RateLimiter } from '../src/main/meta/rateLimiter.js';
import { MetaError, NetworkError, toUserError } from '../src/main/meta/errors.js';
import { assertReadOnly, toCsv } from '../src/main/export/csv.js';

describe('RateLimiter', () => {
  it('doubles delay above 80% and quadruples above 95%', () => {
    const rl = new RateLimiter({ baseDelayMs: 100 });
    expect(rl.currentDelayMs()).toBe(100);
    rl.observe(new Map([['x-app-usage', JSON.stringify({ call_count: 85, total_time: 10, total_cputime: 5 })]]));
    expect(rl.multiplier()).toBe(2);
    rl.observe(new Map([['x-business-use-case-usage', JSON.stringify({ '123': [{ call_count: 97 }] })]]));
    expect(rl.currentDelayMs()).toBe(400);
  });
});

describe('error translation', () => {
  it('maps token / rate limit / permission codes to user messages', () => {
    expect(toUserError(new MetaError({ code: 190, message: 'expired' })).message).toMatch(/expired/);
    expect(toUserError(new MetaError({ code: 4, message: 'limit' })).message).toMatch(/rate limit/);
    expect(toUserError(new MetaError({ code: 10, message: 'perm', endpoint: '/1/insights' })).message).toContain('instagram_manage_insights');
    expect(toUserError(new NetworkError('ENOTFOUND')).code).toBe('NETWORK');
    expect(toUserError(new MetaError({ code: 190, message: 'x' }), 'en').message).toMatch(/expired/);
    expect(new MetaError({ code: 613, message: '' }).isRetryable).toBe(true);
  });
  it('returns Turkish messages when lang is tr', () => {
    expect(toUserError(new MetaError({ code: 190, message: 'x' }), 'tr').message).toMatch(/süresi doldu/);
    expect(toUserError(new NetworkError('ENOTFOUND'), 'tr').message).toMatch(/İnternet/);
    expect(toUserError({}).message).toBe('An unexpected error occurred.');
  });
});

describe('csv', () => {
  it('only allows SELECT statements', () => {
    expect(() => assertReadOnly('SELECT 1')).not.toThrow();
    expect(() => assertReadOnly('DELETE FROM accounts')).toThrow();
    expect(() => assertReadOnly('SELECT 1; DROP TABLE accounts')).toThrow();
  });
  it('escapes cells', () => {
    expect(toCsv(['a', 'b'], [{ a: 'x,y', b: 'q"r' }])).toContain('"x,y","q""r"');
  });
});

describe('graph client writes (v1.4)', () => {
  const limiter = () => new RateLimiter({ baseDelayMs: 0 });
  const graphErr = (code, extra = {}) => new Response(JSON.stringify({ error: { code, message: `err ${code}`, type: 'OAuthException', fbtrace_id: 'TRACE1', ...extra } }), { status: 400, headers: { 'content-type': 'application/json' } });
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  let calls;
  const stub = (...responses) => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => { calls.push({ url: String(url), init }); return responses.shift() ?? ok({}); }));
  };
  afterEach(() => vi.unstubAllGlobals());

  it('post sends a urlencoded body with the token and does not retry rate limits', async () => {
    const client = createGraphClient({ base: 'https://graph.facebook.com/v26.0', limiter: limiter() });
    stub(graphErr(4));
    await expect(client.post('/1/media', { image_url: 'https://x/a.jpg', children: ['1', '2'] }, { token: 'T' })).rejects.toMatchObject({ code: 4, fbtraceId: 'TRACE1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe('POST');
    const body = new URLSearchParams(calls[0].init.body);
    expect(body.get('access_token')).toBe('T');
    expect(body.get('children')).toBe('["1","2"]');
    expect(calls[0].url).not.toContain('access_token');
  });

  it('post retries only when the caller opts in', async () => {
    const client = createGraphClient({ base: 'https://graph.facebook.com/v26.0', limiter: limiter() });
    vi.useFakeTimers();
    try {
      stub(graphErr(4), ok({ id: '9' }));
      const p = client.post('/1/feed', { message: 'hi' }, { token: 'T', maxRetries: 1 });
      await vi.runAllTimersAsync();
      await expect(p).resolves.toEqual({ id: '9' });
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('postForm keeps the error envelope (subcode, user message, fbtrace_id) and supports a base override', async () => {
    const client = createGraphClient({ base: 'https://graph.facebook.com/v26.0', limiter: limiter() });
    stub(graphErr(100, { error_subcode: 2207026, error_user_title: 'Unsupported video', error_user_msg: 'Use MP4' }));
    const form = new FormData();
    form.set('source', new Blob([Buffer.from('abc')]), 'a.mp4');
    const err = await client.postForm('/1/videos', form, { token: 'T', base: 'https://graph-video.facebook.com/v26.0' }).catch((e) => e);
    expect(err).toBeInstanceOf(MetaError);
    expect(err).toMatchObject({ code: 100, subcode: 2207026, fbtraceId: 'TRACE1', userTitle: 'Unsupported video', userMessage: 'Use MP4', source: 'meta', endpoint: '/1/videos' });
    expect(calls[0].url).toBe('https://graph-video.facebook.com/v26.0/1/videos');
    expect(calls[0].init.body.get('access_token')).toBe('T');
  });

  it('postBinary posts the raw body with caller headers; rupload debug_info becomes a MetaError', async () => {
    const client = createGraphClient({ base: 'https://graph.facebook.com/v26.0', limiter: limiter() });
    stub(ok({ success: true }), new Response(JSON.stringify({ debug_info: { type: 'ProcessingFailedError', message: 'bad offset' } }), { status: 400 }));
    const headers = { Authorization: 'OAuth T', offset: '0', file_size: '3' };
    await expect(client.postBinary('https://rupload.facebook.com/ig-api-upload/v26.0/123', new Blob([Buffer.from('abc')]), { headers })).resolves.toEqual({ success: true });
    expect(calls[0].init).toMatchObject({ method: 'POST', headers });
    await expect(client.postBinary('https://rupload.facebook.com/ig-api-upload/v26.0/123', new Blob([Buffer.from('abc')]), { headers })).rejects.toMatchObject({ message: 'bad offset', status: 400 });
    expect(calls).toHaveLength(2);
  });

  it('del sends DELETE with the token as a query param; get still retries reads', async () => {
    const client = createGraphClient({ base: 'https://graph.threads.net/v1.0', limiter: limiter(), name: 'threads' });
    stub(ok({ success: true }));
    await client.del('/55', {}, { token: 'T' });
    expect(calls[0]).toMatchObject({ url: 'https://graph.threads.net/v1.0/55?access_token=T', init: { method: 'DELETE' } });
    vi.useFakeTimers();
    try {
      stub(graphErr(17), ok({ id: '1' }));
      const p = client.get('/me', {}, { token: 'T' });
      await vi.runAllTimersAsync();
      await expect(p).resolves.toEqual({ id: '1' });
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
