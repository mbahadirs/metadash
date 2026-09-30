/** v2.0 chunk D: poller — post selection heuristic, cursor updates, soft errors, first-response bookkeeping, periodic. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { q } from '../src/main/db/index.js';
import { setSetting } from '../src/main/db/queries/settings.js';
import { pollCandidates, getCursor, setCursor, listInbox } from '../src/main/db/queries/inbox.js';
import { pollPosts, syncAccountComments, runPeriodicPoll, periodic, deniedRecently } from '../src/main/inbox/poller.js';
import { MetaError } from '../src/main/meta/errors.js';
import { openTempDb, seedAccounts, post, IG, FB, DAY, HOUR } from './inbox.fixtures.js';

const NOW = Date.now();
let close;
beforeAll(() => {
  close = openTempDb();
  seedAccounts();
  post('p-new', IG, NOW - 2 * DAY);
  post('p-10d', IG, NOW - 10 * DAY);
  post('p-old-grew', IG, NOW - 40 * DAY);
  post('p-old-same', IG, NOW - 40 * DAY);
  post('p-old-never', IG, NOW - 50 * DAY);
  post('p-ancient', IG, NOW - 200 * DAY);
  post('p-story', IG, NOW - DAY, { productType: 'STORY' });
  setCursor(IG, 'p-old-grew', { lastPolledAt: NOW - 5 * DAY, lastCommentCount: 3 });
  setCursor(IG, 'p-old-same', { lastPolledAt: NOW - 5 * DAY, lastCommentCount: 4 });
  setCursor(IG, 'p-ancient', { lastPolledAt: NOW - 5 * DAY, lastCommentCount: 0 });
  q.run('INSERT OR REPLACE INTO media_latest (media_id, comments) VALUES (?, ?)', 'p-old-grew', 5);
  q.run('INSERT OR REPLACE INTO media_latest (media_id, comments) VALUES (?, ?)', 'p-old-same', 4);
  q.run('INSERT OR REPLACE INTO media_latest (media_id, comments) VALUES (?, ?)', 'p-ancient', 9);
  post('fb-p1', FB, NOW - DAY, { externalId: '55_1' });
});
afterAll(() => close());

const igComment = (id, { at, username = 'fan', text = 'Hi', parentId = null, owner = false } = {}) => ({
  commentId: id, externalId: id, mediaId: 'p-new', accountId: IG, platform: 'instagram', parentId, authorId: null, username, text,
  likeCount: 0, createdAt: at, isFromOwner: owner, permalink: null, isHidden: false,
});

describe('post selection', () => {
  it('recent posts always, older posts only when their comment count grew (≤ 90 days), no stories', () => {
    const ids = pollCandidates(IG, { now: NOW, lookbackDays: 14 }).map((m) => m.media_id);
    expect(ids).toEqual(['p-new', 'p-10d', 'p-old-grew']);
    expect(pollCandidates(IG, { now: NOW, lookbackDays: 3 }).map((m) => m.media_id)).toEqual(['p-new', 'p-old-grew']);
  });
});

describe('pollPosts', () => {
  it('stores comments with the question rule, updates the cursor and records first responses', async () => {
    const adapter = { fetch: async (_ctx, _a, p) => (p.mediaId === 'p-new' ? [
      igComment('q1', { at: NOW - 5 * HOUR, text: 'Kargo ne kadar sürer' }),
      igComment('q1r', { at: NOW - 4 * HOUR, username: 'cafe_brand', owner: true, parentId: 'q1', text: '2 gün' }),
      igComment('q2', { at: NOW - 3 * HOUR, text: 'Love it' }),
    ] : []) };
    const res = await pollPosts({}, adapter, { igId: IG }, pollCandidates(IG, { now: NOW }), { now: NOW });
    expect(res).toEqual({ fetched: 3, posts: 3, errors: 0, stopped: false });
    expect(getCursor(IG, 'p-new')).toEqual({ lastPolledAt: NOW, lastCommentCount: 2 });
    expect(getCursor(IG, 'p-old-grew')).toEqual({ lastPolledAt: NOW, lastCommentCount: 5 });
    expect(q.get("SELECT status, is_question, first_response_minutes, first_response_source FROM inbox_state WHERE comment_id = 'q1'"))
      .toEqual({ status: 'replied', is_question: 1, first_response_minutes: 60, first_response_source: 'platform' });
    expect(q.get("SELECT reply_latency_minutes FROM comments WHERE comment_id = 'q1r'").reply_latency_minutes).toBe(60);
    expect(listInbox({ accountIds: [IG] }, undefined, { now: NOW }).items.map((i) => i.commentId)).toEqual(['q2']);
    // after the poll the grown post is up to date and drops out of the selection
    expect(pollCandidates(IG, { now: NOW }).map((m) => m.media_id)).toEqual(['p-new', 'p-10d']);
  });

  it('a permission error is logged and stops the account; token errors propagate', async () => {
    const logs = [];
    let calls = 0;
    const perm = { fetch: async () => { calls += 1; throw new MetaError({ code: 10, message: 'no perm' }); } };
    expect(await pollPosts({}, perm, { igId: IG }, pollCandidates(IG, { now: NOW }), { now: NOW, log: (e) => logs.push(e) })).toMatchObject({ stopped: true, errors: 1 });
    expect(calls).toBe(1);
    expect(logs[0]).toMatchObject({ endpoint: 'comments', code: 10 });
    // background polls skip the refused account for a day; a successful (manual) poll clears the back-off
    expect(deniedRecently(IG, NOW)).toBe(true);
    expect(await syncAccountComments({}, { platform: 'instagram' }, { igId: IG }, { now: NOW })).toEqual({ fetched: 0, skipped: 'denied' });
    await pollPosts({}, { fetch: async () => [] }, { igId: IG }, [{ media_id: 'p-new' }], { now: NOW });
    expect(deniedRecently(IG, NOW)).toBe(false);
    const token = { fetch: async () => { throw new MetaError({ code: 190, message: 'expired' }); } };
    await expect(pollPosts({}, token, { igId: IG }, pollCandidates(IG, { now: NOW }), { now: NOW })).rejects.toMatchObject({ code: 190 });
  });

  it('a changed text clears the stored sentiment (re-classified later)', async () => {
    q.run("UPDATE inbox_state SET sentiment = 'positive', sentiment_at = 1 WHERE comment_id = 'q2'");
    const adapter = { fetch: async (_c, _a, p) => (p.mediaId === 'p-new' ? [igComment('q2', { at: NOW - 3 * HOUR, text: 'Love it (edited)' })] : []) };
    await pollPosts({}, adapter, { igId: IG }, [{ media_id: 'p-new' }], { now: NOW });
    expect(q.get("SELECT sentiment, sentiment_at FROM inbox_state WHERE comment_id = 'q2'")).toEqual({ sentiment: null, sentiment_at: null });
  });
});

describe('syncAccountComments / periodic', () => {
  it('routes through the platform adapter (Facebook via ctx.pageTokens) and falls back gracefully without one', async () => {
    const ctx = { pageTokens: new Map([['55', 'PAGE']]), meta: { getAll: async (path, params, opts) => { expect(opts.token).toBe('PAGE'); expect(path).toBe('/55_1/comments'); return [{ id: '55_1_x', message: 'Hello', created_time: new Date(NOW - HOUR).toISOString(), from: { id: '1', name: 'A' } }]; } } };
    const res = await syncAccountComments(ctx, { platform: 'facebook' }, { igId: FB, externalId: '55', platform: 'facebook' }, { now: NOW });
    expect(res.fetched).toBe(1);
    expect(q.get("SELECT platform, account_id, external_id FROM comments WHERE comment_id = 'fbc-55_1_x'")).toEqual({ platform: 'facebook', account_id: FB, external_id: '55_1_x' });
    expect(await syncAccountComments({}, { platform: 'tiktok' }, { igId: 'tt-1' }, { now: NOW })).toEqual({ fetched: 0 });
  });

  it('periodic runs sync scope inbox and treats a busy sync as skipped', async () => {
    expect(periodic.id).toBe('inbox.poll');
    expect(periodic.intervalMs).toBe(30 * 60_000);
    const scopes = [];
    expect(await runPeriodicPoll({ run: async (o) => { scopes.push(o.scope); return { status: 'ok' }; } })).toEqual({ status: 'ok' });
    expect(scopes).toEqual(['inbox']);
    expect(await runPeriodicPoll({ run: async () => { throw new Error('SYNC_LOCKED'); } })).toEqual({ skipped: 'SYNC_LOCKED' });
    await expect(runPeriodicPoll({ run: async () => { throw new Error('boom'); } })).rejects.toThrow('boom');
    setSetting('inbox.poll', false);
    expect(await runPeriodicPoll({ run: async () => ({}) })).toEqual({ skipped: 'disabled' });
  });
});
