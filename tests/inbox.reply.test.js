/** v2.0 chunk D: reply outbox — transitions, confirmation, limits, crash recovery, owner-reply insertion, retry, hide. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { q } from '../src/main/db/index.js';
import { thread, outboxFor, listInbox, beginSend, getOutbox } from '../src/main/db/queries/inbox.js';
import { sendInboxReply, retryInboxReply, hideInboxComment, STALE_SENDING_MS } from '../src/main/inbox/reply.js';
import { MetaError } from '../src/main/meta/errors.js';
import { progressBus } from '../src/main/sync/progress.js';
import { openTempDb, seedAccounts, post, comment, IG, FB, TH, HOUR } from './inbox.fixtures.js';

const NOW = Date.now();
let close;
beforeAll(() => {
  close = openTempDb();
  seedAccounts();
  post('m1', IG, NOW - 2 * 86_400_000);
  post('fbp', FB, NOW - 86_400_000, { externalId: '55_1' });
  post('thp', TH, NOW - 86_400_000, { externalId: '100' });
  comment('c1', 'm1', { at: NOW - 5 * HOUR, text: 'Do you ship to Izmir?' });
  comment('c2', 'm1', { at: NOW - 4 * HOUR, text: 'Nice' });
  comment('c3', 'm1', { at: NOW - 3 * HOUR, text: 'Price?' });
  comment('fbc-1', 'fbp', { at: NOW - 2 * HOUR, text: 'Open today?', username: 'Ayşe' });
  comment('th-5', 'thp', { at: NOW - 2 * HOUR, text: 'hi' });
  comment('c1-own', 'm1', { at: NOW - HOUR, owner: true, username: 'cafe_brand', text: 'Menu' });
});
afterAll(() => close());

const okAdapter = (calls = []) => ({
  scopes: { read: [], reply: ['instagram_manage_comments'], hide: ['instagram_manage_comments'] }, maxReplyLength: 20,
  reply: async (_ctx, account, c, text) => { calls.push([account.igId, c.externalId, text]); return { remoteId: `r-${calls.length}`, createdAt: NOW }; },
  hide: async (_ctx, _a, c, hidden) => { calls.push(['hide', c.externalId, hidden]); },
  fetch: async () => [],
});

describe('sendInboxReply', () => {
  it('requires confirmation, a body, a replyable top-level comment and the platform limit', async () => {
    const d = { adapter: okAdapter(), isDemo: false, ctx: {} };
    await expect(sendInboxReply({ commentId: 'c1', body: 'x' }, d)).rejects.toMatchObject({ key: 'inbox_confirm_required' });
    await expect(sendInboxReply({ commentId: 'c1', body: '   ', confirmed: true }, d)).rejects.toMatchObject({ key: 'inbox_reply_empty' });
    await expect(sendInboxReply({ commentId: 'c1', body: 'x'.repeat(21), confirmed: true }, d)).rejects.toMatchObject({ key: 'inbox_reply_too_long' });
    await expect(sendInboxReply({ commentId: 'c1-own', body: 'x', confirmed: true }, d)).rejects.toMatchObject({ key: 'inbox_not_replyable' });
    await expect(sendInboxReply({ commentId: "c1' OR 1=1", body: 'x', confirmed: true }, d)).rejects.toMatchObject({ key: 'inbox_bad_input' });
    await expect(sendInboxReply({ commentId: 'nope', body: 'x', confirmed: true }, d)).rejects.toMatchObject({ key: 'inbox_comment_not_found' });
    await expect(sendInboxReply({ commentId: 'c1', body: 'x', confirmed: true }, { ...d, adapter: { fetch: async () => [] } })).rejects.toMatchObject({ key: 'inbox_reply_unsupported' });
    expect(outboxFor('c1')).toEqual([]);
  });

  it('sending → sent: inserts the owner reply, first response (app) and emits inbox:updated', async () => {
    const calls = [];
    const events = [];
    const on = (e) => events.push(e);
    progressBus.on('inbox:updated', on);
    const row = await sendInboxReply({ commentId: 'c1', body: '  Yes, we do!  ', confirmed: true }, { adapter: okAdapter(calls), isDemo: false, ctx: {}, now: NOW, author: 'Ayşe' });
    progressBus.off('inbox:updated', on);
    expect(calls).toEqual([[IG, 'c1', 'Yes, we do!']]);
    expect(row).toMatchObject({ commentId: 'c1', status: 'sent', remoteId: 'r-1', attempts: 1, author: 'Ayşe', body: 'Yes, we do!', sentAt: NOW });
    expect(q.get("SELECT parent_id, is_from_owner, platform, account_id, reply_latency_minutes FROM comments WHERE comment_id = 'r-1'"))
      .toEqual({ parent_id: 'c1', is_from_owner: 1, platform: 'instagram', account_id: IG, reply_latency_minutes: 300 });
    expect(q.get("SELECT status, first_response_source, first_response_minutes FROM inbox_state WHERE comment_id = 'c1'")).toEqual({ status: 'replied', first_response_source: 'app', first_response_minutes: 300 });
    expect(events).toEqual([{ reason: 'reply', commentIds: ['c1'], accountIds: [IG] }]);
    expect(thread('c1').replies.map((r) => [r.commentId, r.isFromOwner])).toEqual([['r-1', true]]);
  });

  it('prefixes the stored owner-reply key per platform (Facebook fbc-, Threads th-)', async () => {
    await sendInboxReply({ commentId: 'fbc-1', body: 'Yes', confirmed: true }, { adapter: okAdapter(), isDemo: false, ctx: {}, now: NOW });
    expect(q.get("SELECT comment_id FROM comments WHERE parent_id = 'fbc-1'").comment_id).toBe('fbc-r-1');
    await sendInboxReply({ commentId: 'th-5', body: 'Hey', confirmed: true }, { adapter: okAdapter(), isDemo: false, ctx: {}, now: NOW });
    expect(q.get("SELECT comment_id FROM comments WHERE parent_id = 'th-5'").comment_id).toBe('th-r-1');
  });

  it('failure → failed with the error; permission errors name the missing scope; retry re-sends the same body', async () => {
    const failing = { ...okAdapter(), reply: async () => { throw new MetaError({ code: 10, message: 'Permission denied' }); } };
    await expect(sendInboxReply({ commentId: 'c2', body: 'Thanks', confirmed: true }, { adapter: failing, isDemo: false, ctx: {}, now: NOW }))
      .rejects.toMatchObject({ key: 'inbox_missing_scope', message: expect.stringContaining('instagram_manage_comments') });
    const [failed] = outboxFor('c2');
    expect(failed).toMatchObject({ status: 'failed', errorCode: 'permission', attempts: 1 });
    expect(listInbox({ accountIds: [IG] }, undefined, { now: NOW }).items.map((i) => i.commentId)).toContain('c2');
    const calls = [];
    const again = await retryInboxReply({ outboxId: failed.id }, { adapter: okAdapter(calls), isDemo: false, ctx: {}, now: NOW });
    expect(again).toMatchObject({ id: failed.id, status: 'sent', attempts: 2 });
    expect(calls[0][2]).toBe('Thanks');
    await expect(retryInboxReply({ outboxId: failed.id }, { adapter: okAdapter(), isDemo: false, ctx: {} })).rejects.toMatchObject({ key: 'inbox_retry_not_failed' });
    await expect(retryInboxReply({ outboxId: 99999 }, {})).rejects.toMatchObject({ key: 'inbox_outbox_not_found' });
  });

  it('crash recovery: a fresh sending row blocks, a stale one resolves to sent (reply found) or failed (not found)', async () => {
    const id = beginSend({ commentId: 'c3', accountId: IG, platform: 'instagram', body: 'See DM', now: NOW - 60_000 });
    await expect(sendInboxReply({ commentId: 'c3', body: 'See DM', confirmed: true }, { adapter: okAdapter(), isDemo: false, ctx: {}, now: NOW })).rejects.toMatchObject({ key: 'inbox_send_in_progress' });
    // the reply did reach Instagram before the crash: a poll stored it
    comment('c3-r', 'm1', { at: NOW - 50_000, owner: true, username: 'cafe_brand', parentId: 'c3', text: 'See DM' });
    const later = NOW + STALE_SENDING_MS;
    const calls = [];
    await sendInboxReply({ commentId: 'c3', body: 'Anything else?', confirmed: true }, { adapter: okAdapter(calls), isDemo: false, ctx: {}, now: later });
    expect(getOutbox(id)).toMatchObject({ status: 'sent', remoteId: 'c3-r' });
    expect(calls).toHaveLength(1);
    const id2 = beginSend({ commentId: 'c3', accountId: IG, platform: 'instagram', body: 'lost', now: later });
    await sendInboxReply({ commentId: 'c3', body: 'Again', confirmed: true }, { adapter: okAdapter(), isDemo: false, ctx: {}, now: later + STALE_SENDING_MS + 1 });
    expect(getOutbox(id2)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
  });

  it('demo mode simulates the send (no adapter call)', async () => {
    comment('c9', 'm1', { at: NOW - HOUR, text: 'demo?' });
    const calls = [];
    const row = await sendInboxReply({ commentId: 'c9', body: 'ok', confirmed: true }, { adapter: okAdapter(calls), isDemo: true, now: NOW });
    expect(row.status).toBe('sent');
    expect(row.remoteId).toMatch(/^demo-/);
    expect(calls).toEqual([]);
  });
});

describe('hideInboxComment', () => {
  it('calls the adapter and stores the flag; unsupported platforms fail clearly', async () => {
    const calls = [];
    expect(await hideInboxComment({ commentId: 'c2', hidden: true }, { adapter: okAdapter(calls), isDemo: false, ctx: {} })).toBe(true);
    expect(calls).toEqual([['hide', 'c2', true]]);
    expect(q.get("SELECT is_hidden FROM comments WHERE comment_id = 'c2'").is_hidden).toBe(1);
    await expect(hideInboxComment({ commentId: 'c2', hidden: false }, { adapter: { fetch: async () => [] }, isDemo: false })).rejects.toMatchObject({ key: 'inbox_hide_unsupported' });
  });
});
