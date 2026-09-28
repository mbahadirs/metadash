import { describe, it, expect } from 'vitest';
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
