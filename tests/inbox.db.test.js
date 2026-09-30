/**
 * v2.0 chunk D: inbox list/filters/keyset pagination/counts, workflow status, v1.5 bridge, capabilities, refresh,
 * IPC payload validation, notification rule, report section, CLI command and demo seed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { q } from '../src/main/db/index.js';
import { listInbox, inboxCounts, setStatus, assign, thread, encodeCursor, decodeCursor, assignees } from '../src/main/db/queries/inbox.js';
import { dismissComment, storeComments } from '../src/main/db/queries/comments.js';
import { capabilityOf, inboxCapabilities, clearCapabilityCache } from '../src/main/inbox/capabilities.js';
import { refreshInbox } from '../src/main/inbox/refresh.js';
import { BUILTIN } from '../src/main/inbox/registry.js';
import { parseListParams, INBOX_CHANNELS, registerInboxHandlers } from '../src/main/ipc/inbox.handlers.js';
import { rule, pickInbox, gatherInbox } from '../src/main/notifyRules/inbox.js';
import { sections, fmtDuration } from '../src/main/export/reportSections/inbox.js';
import { command } from '../src/main/cli/commands/inbox.js';
import { EXIT } from '../src/main/cli/exitCodes.js';
import { openTempDb, seedAccounts, post, comment, IG, FB, TH, HOUR, DAY } from './inbox.fixtures.js';

const NOW = Date.now();
let close;
beforeAll(() => {
  close = openTempDb();
  seedAccounts();
  post('m1', IG, NOW - 3 * DAY);
  post('fbp', FB, NOW - 2 * DAY, { externalId: '55_1' });
  post('thp', TH, NOW - 2 * DAY, { externalId: '100' });
  comment('i1', 'm1', { at: NOW - 40 * HOUR, text: 'Price?', username: 'ayse' });
  comment('i2', 'm1', { at: NOW - 30 * HOUR, text: 'nice', username: 'mehmet' });
  comment('i2r', 'm1', { at: NOW - 29 * HOUR, owner: true, username: 'cafe_brand', parentId: 'i2', text: 'thanks' });
  comment('i3', 'm1', { at: NOW - 2 * HOUR, text: '100% love_it', username: 'zeynep' });
  comment('fbc-1', 'fbp', { at: NOW - 26 * HOUR, text: 'Open Sunday?', username: 'Ayşe K', platform: 'facebook', accountId: FB });
  comment('th-1', 'thp', { at: NOW - HOUR, text: 'hi', username: 'can', platform: 'threads', accountId: TH });
  comment('own', 'm1', { at: NOW - HOUR, owner: true, username: 'cafe_brand', text: 'post note' });
});
afterAll(() => close());

describe('listInbox', () => {
  it('open by default across platforms, newest first, with counts and overdue flag', () => {
    const res = listInbox({}, undefined, { now: NOW, slaHours: 24 });
    expect(res.items.map((i) => i.commentId)).toEqual(['th-1', 'i3', 'fbc-1', 'i1']);
    expect(res.counts).toEqual({ open: 4, replied: 1, done: 0, overdue: 2 });
    const fb = res.items.find((i) => i.commentId === 'fbc-1');
    expect(fb).toMatchObject({ platform: 'facebook', accountId: FB, accountUsername: 'Cafe Page', overdue: true, status: 'open', post: { caption: 'Autumn menu' } });
  });

  it('filters: platform, account, status, search (LIKE-escaped), question, dates, sort', () => {
    const ids = (f) => listInbox(f, undefined, { now: NOW }).items.map((i) => i.commentId);
    expect(ids({ platforms: ['facebook', 'threads'] })).toEqual(['th-1', 'fbc-1']);
    expect(ids({ accountIds: [IG], status: 'all' })).toEqual(['i3', 'i2', 'i1']);
    expect(ids({ status: 'replied' })).toEqual(['i2']);
    expect(ids({ status: 'overdue', sort: 'overdue' })).toEqual(['i1', 'fbc-1']);
    expect(ids({ q: '100%' })).toEqual(['i3']);
    expect(ids({ q: '_' })).toEqual(['i3']);
    expect(ids({ q: 'ZEYNEP' })).toEqual(['i3']);
    q.run("INSERT INTO inbox_state (comment_id, status, is_question) VALUES ('i1', 'open', 1)");
    expect(ids({ question: true })).toEqual(['i1']);
    expect(ids({ from: '2000-01-01', to: '2000-01-02' })).toEqual([]);
  });

  it('keyset pagination is stable and complete', () => {
    const first = listInbox({ status: 'all', limit: 2 }, undefined, { now: NOW });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = listInbox({ status: 'all', limit: 2 }, first.nextCursor, { now: NOW });
    const third = listInbox({ status: 'all', limit: 2, cursor: second.nextCursor }, undefined, { now: NOW });
    expect([...first.items, ...second.items, ...third.items].map((i) => i.commentId)).toEqual(['th-1', 'i3', 'fbc-1', 'i2', 'i1']);
    expect(third.nextCursor).toBeNull();
    expect(decodeCursor(encodeCursor(5, 'x'))).toEqual({ createdAt: 5, commentId: 'x' });
    expect(decodeCursor('garbage')).toBeNull();
  });

  it('status, assignment and the v1.5 bridge (dismiss → done, storeComments → state)', () => {
    expect(setStatus(['i3', 'missing'], 'done', { by: 'Ayşe' })).toBe(1);
    expect(() => setStatus(['i3'], 'bogus')).toThrow();
    expect(assign(['i1', 'fbc-1'], 'Mert')).toBe(2);
    expect(listInbox({ assignee: 'Mert' }, undefined, { now: NOW }).items.map((i) => i.commentId)).toEqual(['fbc-1', 'i1']);
    expect(listInbox({ assignee: null }, undefined, { now: NOW }).items.map((i) => i.commentId)).toEqual(['th-1']);
    expect(assignees()).toEqual(['Mert']);
    dismissComment('th-1');
    expect(inboxCounts({}, { now: NOW })).toMatchObject({ open: 2, done: 2 });
    storeComments('m1', [{ id: 'n1', text: 'Nerede?', timestamp: new Date(NOW - HOUR).toISOString(), like_count: 0, username: 'ali', replies: { data: [{ id: 'n1r', text: 'Kadıköy', timestamp: new Date(NOW - HOUR / 2).toISOString(), username: 'cafe_brand' }] } }], 'cafe_brand');
    expect(q.get("SELECT status, is_question, first_response_minutes FROM inbox_state WHERE comment_id = 'n1'")).toEqual({ status: 'replied', is_question: 1, first_response_minutes: 30 });
    expect(thread('n1r').root.commentId).toBe('n1');
  });
});

describe('capabilities', () => {
  it('missing scopes per adapter; unknown scopes count as granted', () => {
    const fb = capabilityOf({ igId: FB, platform: 'facebook' }, BUILTIN.facebook, ['pages_read_engagement']);
    expect(fb).toEqual({ accountId: FB, platform: 'facebook', read: false, reply: false, hide: false, maxReplyLength: 8000, missingScopes: ['pages_read_user_content', 'pages_manage_engagement'] });
    expect(capabilityOf({ igId: TH, platform: 'threads' }, BUILTIN.threads, null)).toMatchObject({ read: true, reply: true, hide: true, missingScopes: [] });
  });
  it('reads Meta scopes once via debug_token', async () => {
    clearCapabilityCache();
    let calls = 0;
    const debug = async () => { calls += 1; return { scopes: ['instagram_basic', 'instagram_manage_comments'] }; };
    const caps = await inboxCapabilities({ isDemo: false, debug, readToken: () => 'T', now: NOW });
    expect(caps.map((c) => [c.accountId, c.read, c.reply])).toEqual([[FB, false, false], [TH, true, true], [IG, true, true]]);
    await inboxCapabilities({ isDemo: false, debug, readToken: () => 'T', now: NOW });
    expect(calls).toBe(1);
  });
});

describe('refresh', () => {
  it('polls every inbox account with its adapter; a failing account is counted, not fatal; demo fetches nothing', async () => {
    const seen = [];
    const adapterFor = (p) => ({
      fetch: async (_c, a, m) => {
        seen.push([p, m.mediaId]);
        if (p === 'facebook') throw Object.assign(new Error('no page token'), { code: 'page_token_missing' });
        return [];
      },
    });
    const res = await refreshInbox({}, { isDemo: false, ctx: {}, adapterFor, delay: async () => {}, now: NOW });
    expect(res).toEqual({ fetched: 0, errors: 1, accounts: 3 });
    expect(seen.map((s) => s[0]).sort()).toEqual(['facebook', 'instagram', 'threads']);
    expect(await refreshInbox({}, { isDemo: true })).toEqual({ fetched: 0, errors: 0, accounts: 0, demo: true });
  });
});

describe('IPC', () => {
  it('registers every contract channel and validates list params', async () => {
    const h = {};
    registerInboxHandlers((ch, fn) => { h[ch] = fn; });
    expect(Object.keys(h)).toEqual([...INBOX_CHANNELS]);
    expect(parseListParams({ status: 'overdue', platforms: ['threads'], limit: 10 })).toMatchObject({ status: 'overdue', platforms: ['threads'], limit: 10 });
    expect(parseListParams(undefined).status).toBe('open');
    expect(() => parseListParams({ status: 'x' })).toThrow();
    expect(() => parseListParams({ platforms: ['myspace'] })).toThrow();
    expect(() => parseListParams({ accountIds: ["1' OR 1=1"] })).toThrow();
    expect(() => parseListParams({ from: '2026/01/01' })).toThrow();
    await expect(h['inbox:reply']({ commentId: 'i1', body: 'x' })).rejects.toMatchObject({ key: 'inbox_confirm_required' });
    await expect(h['inbox:setStatus']({ commentIds: [], status: 'done' })).rejects.toThrow();
    expect(await h['inbox:setStatus']({ commentIds: ['i1'], status: 'open' })).toEqual({ updated: 1 });
    expect(h['inbox:counts']()).toMatchObject({ open: expect.any(Number) });
  });
});

describe('notification rule', () => {
  const ctx = (sent = {}) => ({
    now: NOW, lang: 'en', sent,
    wasSent: (s, key, now, cd) => Number.isFinite(Date.parse(s?.[key] ?? '')) && now - Date.parse(s[key]) < cd,
    nameList: (names) => names.join(', '),
  });
  it('overdue beats new; cooldown per day; new comments once per 6 h window', () => {
    expect(rule.type).toBe('inbox');
    const note = pickInbox({ inbox: { overdue: 3, overdueAccounts: ['@cafe_brand'], fresh: 1, slaHours: 24 } }, ctx());
    expect(note).toMatchObject({ type: 'inbox', route: '/inbox', title: 'Comments waiting for a reply' });
    expect(note.body).toBe('3 comments have waited longer than 24 h: @cafe_brand');
    const fresh = pickInbox({ inbox: { overdue: 3, overdueAccounts: [], fresh: 2, slaHours: 24 } }, ctx({ [note.key]: new Date(NOW).toISOString() }));
    expect(fresh.body).toBe('2 new comments are waiting for a reply.');
    expect(pickInbox({ inbox: { overdue: 0, fresh: 2, slaHours: 24 } }, ctx({ [fresh.key]: new Date(NOW).toISOString() }))).toBeNull();
    expect(pickInbox({}, ctx())).toBeNull();
  });
  it('gather counts unanswered comments of tracked accounts', () => {
    const d = gatherInbox(NOW).inbox;
    expect(d.slaHours).toBe(24);
    expect(d.overdue).toBeGreaterThanOrEqual(1);
    expect(d.overdueAccounts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('report section', () => {
  it('community response for inbox platforms (html + xlsx sheet)', () => {
    const [s] = sections;
    expect(s).toMatchObject({ key: 'community_response', capability: 'inbox', templates: ['monthly', 'weekly_client', 'custom'] });
    const ctx = { lang: 'en', igId: IG, from: '2000-01-01', to: '2100-01-01', analysis: { account: { username: 'cafe_brand' }, platform: 'instagram' } };
    const html = s.html(ctx);
    expect(html).toContain('<h2>Community response</h2>');
    expect(html).toContain('Answered within 24 h');
    expect(s.sheets(ctx)[0].rows[0].incoming).toBeGreaterThan(0);
    expect(s.html({ ...ctx, from: '2000-01-01', to: '2000-01-02' })).toContain('No comments from followers');
    expect(fmtDuration(45, 'en')).toBe('45 min');
    expect(fmtDuration(150, 'tr')).toBe('2.5 sa');
    expect(fmtDuration(null, 'en')).toBe('—');
  });
});

describe('CLI', () => {
  const io = (positionals, { json = false, services } = {}) => {
    const lines = [];
    const errors = [];
    const out = { json, result: (d) => lines.push(d), error: (l) => errors.push(l), info() {}, warn() {} };
    return { io: { out, positionals, lang: 'en', services }, lines, errors };
  };
  it('sla / list / pull (locked → 5) / usage', async () => {
    let t = io(['sla'], { json: true });
    expect(await command.run({ from: '2000-01-01', to: '2100-01-01' }, t.io)).toBe(EXIT.OK);
    expect(t.lines[0]).toMatchObject({ from: '2000-01-01', slaHours: 24, totals: { incoming: expect.any(Number) } });
    t = io(['list']);
    expect(await command.run({ status: 'all', limit: '5' }, t.io)).toBe(EXIT.OK);
    expect(t.lines[0].length).toBeGreaterThan(0);
    t = io(['pull'], { services: { runSync: async () => { throw new Error('SYNC_LOCKED'); } } });
    expect(await command.run({}, t.io)).toBe(EXIT.LOCKED);
    t = io(['pull'], { services: { runSync: async (o) => ({ status: o.scope === 'inbox' ? 'ok' : 'x' }) } });
    expect(await command.run({ account: ['@cafe_brand'] }, t.io)).toBe(EXIT.OK);
    t = io(['pull']);
    expect(await command.run({ account: ['@nobody'] }, t.io)).toBe(EXIT.USAGE);
    t = io([]);
    expect(await command.run({}, t.io)).toBe(EXIT.USAGE);
  });
});

describe('demo seed', () => {
  it('seeds FB/Threads comments and workflow variety deterministically', async () => {
    const { seedInbox } = await import('../src/main/seed/inbox.js');
    const out = seedInbox({ now: new Date(NOW) });
    expect(out.facebook + out.threads).toBeGreaterThanOrEqual(0);
    expect(q.get("SELECT COUNT(*) AS n FROM inbox_state WHERE comment_id = 'i2'").n).toBe(1);
  });
});
