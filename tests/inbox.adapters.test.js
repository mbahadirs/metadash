/** v2.0 chunk D: built-in inbox adapters — normalisation per platform, requests, owner detection, registry. */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createFakeFetch, json } from './fixtures/fakeFetch.js';
import { normalizeInstagram, instagramInbox } from '../src/main/inbox/adapters/instagram.js';
import { normalizeFacebook, facebookInbox } from '../src/main/inbox/adapters/facebook.js';
import { normalizeThreads, threadsInbox } from '../src/main/inbox/adapters/threads.js';
import { topLevelOf } from '../src/main/inbox/adapters/shared.js';
import { adapterFor, BUILTIN } from '../src/main/inbox/registry.js';
import { commentKey, externalIdOf } from '../src/main/inbox/keys.js';
import { createGraphClient } from '../src/main/meta/client.js';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const limiter = { observe() {}, multiplier: () => 1, currentDelayMs: () => 0 };
afterEach(() => vi.unstubAllGlobals());

describe('keys', () => {
  it('IG keeps raw ids, other platforms are prefixed and reversible', () => {
    expect(commentKey('instagram', '179')).toBe('179');
    expect(commentKey('facebook', '1_2')).toBe('fbc-1_2');
    expect(commentKey('threads', '9')).toBe('th-9');
    expect(commentKey('youtube', 'Ug')).toBe('ytc-Ug');
    expect(externalIdOf('facebook', 'fbc-1_2')).toBe('1_2');
    expect(externalIdOf('instagram', '179')).toBe('179');
  });
  it('topLevelOf folds nested replies to their top-level ancestor', () => {
    const parents = new Map([['a', 'P'], ['b', 'a'], ['c', 'b'], ['d', 'zz']]);
    expect(topLevelOf('a', parents, 'P')).toBeNull();
    expect(topLevelOf('b', parents, 'P')).toBe('a');
    expect(topLevelOf('c', parents, 'P')).toBe('a');
    expect(topLevelOf('d', parents, 'P')).toBe('zz'); // parent not in batch: keep it
  });
});

describe('instagram', () => {
  const account = { igId: '1784', username: 'Cafe_Brand', platform: 'instagram' };
  const post = { mediaId: 'm1', externalId: 'm1' };
  it('normalises comments + replies; owner by username (case-insensitive); keeps raw ids', () => {
    const rows = normalizeInstagram([
      { id: 'c1', text: 'Price?', timestamp: '2026-09-30T10:00:00+0000', username: 'ayse', like_count: 2, hidden: false, from: { id: 'u1' },
        replies: { data: [{ id: 'r1', text: 'DM us', timestamp: '2026-09-30T11:00:00+0000', username: 'cafe_brand' }] } },
      { id: 'c2', text: 'x\u0000y', timestamp: 'bad', username: 'cafe_brand' },
    ], { account, post, fetchedAt: NOW });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ commentId: 'c1', externalId: 'c1', parentId: null, authorId: 'u1', isFromOwner: false, likeCount: 2, isHidden: false, platform: 'instagram', accountId: '1784', createdAt: Date.parse('2026-09-30T10:00:00Z') });
    expect(rows[1]).toMatchObject({ commentId: 'r1', parentId: 'c1', isFromOwner: true, isHidden: null });
    expect(rows[2]).toMatchObject({ text: 'xy', createdAt: NOW, isFromOwner: true });
  });
  it('fetch/reply/hide hit the documented endpoints with the user token', async () => {
    const fake = createFakeFetch({ meta: [
      ({ path, method }) => (method === 'GET' && path === '/m1/comments' ? json({ data: [{ id: 'c9', text: 'hi', timestamp: '2026-09-30T10:00:00+0000', username: 'x' }] }) : null),
      ({ path, method }) => (method === 'POST' && path === '/c9/replies' ? json({ id: 'r9' }) : null),
      ({ path, method, body }) => (method === 'POST' && path === '/c9' && new URLSearchParams(body).get('hide') === 'true' ? json({ success: true }) : null),
    ] });
    vi.stubGlobal('fetch', fake);
    const ctx = { tokenFor: () => 'USER', meta: createGraphClient({ base: 'https://graph.facebook.com/v26.0', limiter }) };
    const got = await instagramInbox.fetch(ctx, account, post, { now: NOW });
    expect(got.map((c) => c.commentId)).toEqual(['c9']);
    expect((await instagramInbox.reply(ctx, account, got[0], 'hello')).remoteId).toBe('r9');
    await instagramInbox.hide(ctx, account, got[0], true);
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /m1/comments', 'POST /c9/replies', 'POST /c9']);
  });
});

describe('facebook', () => {
  const account = { igId: 'fb-55', externalId: '55', username: 'Cafe Page', platform: 'facebook' };
  const post = { mediaId: '55_1', externalId: '55_1' };
  it('prefixes keys, folds nested replies, owner = Page id, missing from → empty username', () => {
    const rows = normalizeFacebook([
      { id: '55_1_a', message: 'Open on Sunday?', created_time: '2026-09-30T09:00:00+0000', from: { id: '900', name: 'Ayşe' }, like_count: 1, permalink_url: 'https://facebook.com/x' },
      { id: '55_1_b', message: 'Yes!', created_time: '2026-09-30T09:30:00+0000', from: { id: '55', name: 'Cafe Page' }, parent: { id: '55_1_a' } },
      { id: '55_1_c', message: 'thanks', created_time: '2026-09-30T09:40:00+0000', parent: { id: '55_1_b' }, is_hidden: true, permalink_url: 'javascript:alert(1)' },
    ], { account, post, fetchedAt: NOW });
    expect(rows[0]).toMatchObject({ commentId: 'fbc-55_1_a', externalId: '55_1_a', parentId: null, username: 'Ayşe', authorId: '900', isFromOwner: false, permalink: 'https://facebook.com/x' });
    expect(rows[1]).toMatchObject({ commentId: 'fbc-55_1_b', parentId: 'fbc-55_1_a', isFromOwner: true });
    expect(rows[2]).toMatchObject({ parentId: 'fbc-55_1_a', username: '', authorId: null, isHidden: true, permalink: null });
  });
  it('uses the Page token (sync ctx.pageTokens or publishing ctx.pageToken) and filter=stream', async () => {
    const seen = [];
    const fake = createFakeFetch({ meta: [
      ({ path, query, method }) => { if (method !== 'GET') return null; seen.push([method, path, query.get('access_token'), query.get('filter')]); return json({ data: [] }); },
      ({ path, method, body }) => { const b = new URLSearchParams(body); seen.push([method, path, b.get('access_token'), b.get('message') ?? b.get('is_hidden')]); return json({ id: 'new' }); },
    ] });
    vi.stubGlobal('fetch', fake);
    const meta = createGraphClient({ base: 'https://graph.facebook.com/v26.0', limiter });
    await facebookInbox.fetch({ meta, pageTokens: new Map([['55', 'PAGE']]) }, account, post, { now: NOW });
    const ctx2 = { meta, pageToken: async (id) => `PT-${id}` };
    const c = { externalId: '55_1_a' };
    expect(await facebookInbox.reply(ctx2, account, c, 'Yes')).toMatchObject({ remoteId: 'new' });
    await facebookInbox.hide(ctx2, account, c, true);
    expect(seen).toEqual([
      ['GET', '/55_1/comments', 'PAGE', 'stream'],
      ['POST', '/55_1_a/comments', 'PT-55', 'Yes'],
      ['POST', '/55_1_a', 'PT-55', 'true'],
    ]);
    await expect(facebookInbox.fetch({ meta }, account, post)).rejects.toMatchObject({ code: 'page_token_missing' });
  });
});

describe('threads', () => {
  const account = { igId: 'th-7', externalId: '7', username: 'cafe', platform: 'threads' };
  const post = { mediaId: 'th-100', externalId: '100' };
  it('flattened conversation → top-level replies + nested replies folded; owner flag; hide_status', () => {
    const rows = normalizeThreads([
      { id: '201', text: 'Nasıl sipariş veririm', username: 'ayse', timestamp: '2026-09-30T08:00:00+0000', replied_to: { id: '100' }, hide_status: 'NOT_HUSHED' },
      { id: '202', text: 'Link in bio', username: 'cafe', timestamp: '2026-09-30T08:10:00+0000', replied_to: { id: '201' }, is_reply_owned_by_me: true },
      { id: '203', text: 'ok', username: 'ayse', timestamp: '2026-09-30T08:20:00+0000', replied_to: { id: '202' }, hide_status: 'HIDDEN' },
    ], { account, post, fetchedAt: NOW });
    expect(rows.map((r) => [r.commentId, r.parentId, r.isFromOwner, r.isHidden])).toEqual([
      ['th-201', null, false, false], ['th-202', 'th-201', true, null], ['th-203', 'th-201', false, true],
    ]);
  });
  it('reply = TEXT container with reply_to_id, then threads_publish; hide via manage_reply', async () => {
    const seen = [];
    const fake = createFakeFetch({ threads: [
      ({ path, method, body, query }) => {
        const b = new URLSearchParams(body ?? '');
        seen.push([method, path, method === 'GET' ? query.get('fields')?.includes('is_reply_owned_by_me') : Object.fromEntries(b)]);
        if (path === '/7/threads') return json({ id: 'cont' });
        if (path === '/7/threads_publish') return json({ id: '999' });
        if (path === '/100/conversation') return json({ data: [] });
        return json({ success: true });
      },
    ] });
    vi.stubGlobal('fetch', fake);
    const threads = createGraphClient({ base: 'https://graph.threads.net/v1.0', limiter, name: 'threads' });
    const ctx = { threads, tokenFor: () => 'TH' };
    await threadsInbox.fetch(ctx, account, post, { now: NOW });
    expect(await threadsInbox.reply(ctx, account, { externalId: '201' }, 'Thanks!')).toMatchObject({ remoteId: '999' });
    await threadsInbox.hide(ctx, account, { externalId: '201' }, false);
    expect(seen).toEqual([
      ['GET', '/100/conversation', true],
      ['POST', '/7/threads', { media_type: 'TEXT', text: 'Thanks!', reply_to_id: '201', access_token: 'TH' }],
      ['POST', '/7/threads_publish', { creation_id: 'cont', access_token: 'TH' }],
      ['POST', '/201/manage_reply', { hide: 'false', access_token: 'TH' }],
    ]);
  });
});

describe('registry', () => {
  it('provider.inbox wins, built-ins otherwise, null when none', () => {
    const own = { fetch: async () => [], scopes: { read: [], reply: [], hide: [] }, maxReplyLength: 10000 };
    expect(adapterFor('youtube', { lookup: (p) => (p === 'youtube' ? { inbox: own } : null) })).toBe(own);
    expect(adapterFor('youtube', { lookup: () => null })).toBeNull();
    expect(adapterFor('tiktok', { lookup: () => ({ inbox: null }) })).toBeNull();
    expect(adapterFor('facebook', { lookup: () => ({}) })).toBe(BUILTIN.facebook);
    for (const a of Object.values(BUILTIN)) {
      expect(a.maxReplyLength).toBeGreaterThan(0);
      for (const k of ['read', 'reply', 'hide']) expect(Array.isArray(a.scopes[k])).toBe(true);
    }
    expect(BUILTIN.facebook.scopes.read).toEqual(['pages_read_engagement', 'pages_read_user_content']);
    expect(BUILTIN.threads.scopes.read).toContain('threads_read_replies');
    expect(BUILTIN.threads.maxReplyLength).toBe(500);
  });
});
