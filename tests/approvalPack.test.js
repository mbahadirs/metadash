import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../src/main/db/index.js';
import { createPost, getPost, setPostStatus, updatePost, listAudit, getPack } from '../src/main/db/queries/planner.js';
import { buildApprovalHtml } from '../src/main/planner/approvalHtml.js';
import { mdapLib, scriptJson, clientScript, CODE_PREFIX } from '../src/main/planner/approvalClient.js';
import {
  encodeResponse, decodeResponse, verifyResponse, planImport, importResponse, createPackRecord, selectPackPosts, hmac8,
} from '../src/main/planner/approvalPack.js';
import { resolveBranding } from '../src/main/export/branding.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-approval-'));
const NOW = Date.UTC(2026, 8, 29, 12);
const DAY = 86_400_000;
beforeAll(() => openDb(path.join(dir, 'data.db')));
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

const target = (accountId = 'acc-1', platform = 'instagram') => ({ accountId, platform, format: 'image' });
const PACK = { id: 'pack123', secret: 'sekret', items: [{ postId: 1, ref: 'P-0001', version: 3 }] };
const POST = {
  id: 1, ref: 'P-0001', title: 'Launch <b>day</b>', caption: 'Hello <script>alert(1)</script> & "friends"', firstComment: '#tags <img src=x onerror=alert(2)>',
  notes: 'INTERNAL: client is late on invoices', version: 3, status: 'in_review', scheduledAt: NOW + DAY, timezone: 'Europe/Istanbul',
  targets: [{ id: 1, accountId: 'acc-1', platform: 'instagram', captionOverride: null }, { id: 2, accountId: 'fb-1', platform: 'facebook', captionOverride: 'FB </textarea> text' }],
  assets: [{ assetId: 5, role: 'media', position: 0, altText: 'alt"x', asset: { kind: 'image' } }, { assetId: 6, role: 'media', position: 1, asset: { kind: 'video' } }],
};
const BRAND = resolveBranding({ agencyName: 'Acme <Agency>', accent: '#ff0066', footerText: 'Footer & co' });
const html = (extra = {}) => buildApprovalHtml({
  pack: PACK, posts: [POST], accounts: { 'acc-1': { username: 'brand', platform: 'instagram' }, 'fb-1': { username: 'brandpage', platform: 'facebook' } },
  images: { 5: 'data:image/jpeg;base64,AAAA' }, branding: BRAND, lang: 'en', clientName: 'Client & Sons', now: NOW, ...extra,
});

describe('buildApprovalHtml', () => {
  it('escapes captions, comments, overrides and titles (no XSS)', () => {
    const h = html();
    expect(h).not.toContain('<script>alert(1)</script>');
    expect(h).toContain('Hello &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;friends&quot;');
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('FB &lt;/textarea&gt; text');
    expect(h).toContain('Launch &lt;b&gt;day&lt;/b&gt;');
    expect(h).toContain('alt="alt&quot;x"');
  });
  it('includes refs, version, platform badges, branding and a strict CSP', () => {
    const h = html();
    expect(h).toContain('P-0001');
    expect(h).toContain('version 3');
    expect(h).toContain('IG @brand');
    expect(h).toContain('FB @brandpage');
    expect(h).toContain('Acme &lt;Agency&gt;');
    expect(h).toContain('Footer &amp; co');
    expect(h).toContain('#ff0066');
    expect(h).not.toMatch(/#4F7CFF/i);
    expect(h).toContain("default-src 'none'; img-src data:");
    expect(h).toContain('data:image/jpeg;base64,AAAA');
    expect(h).toContain('1/2');
  });
  it('leaves internal notes out unless asked', () => {
    expect(html()).not.toContain('INTERNAL');
    expect(html({ includeNotes: true })).toContain('INTERNAL: client is late on invoices');
  });
  it('HTML has the response form and script; the PDF variant has neither', () => {
    const h = html();
    expect(h).toContain('name="d-P-0001"');
    expect(h).toContain('<script>');
    const pdf = html({ pdf: true });
    expect(pdf).not.toContain('<script');
    expect(pdf).not.toContain('name="d-P-0001"');
    expect(pdf).toContain('reply by email');
    expect(pdf).not.toContain("script-src");
  });
  it('localizes labels', () => {
    expect(html({ lang: 'tr' })).toContain('Değişiklik iste');
  });
  it('embeds pack data safely inside the script', () => {
    expect(scriptJson({ x: '</script><script>alert(1)</script>' })).not.toContain('</script>');
    const s = clientScript({ prefix: CODE_PREFIX, packId: 'p', secret: 's', items: [], labels: {} });
    expect(() => new Function(s.replace(/^\(function\(\)\{/, 'return;(function(){'))).not.toThrow(); // parses
  });
});

describe('response code', () => {
  const items = [{ ref: 'P-0001', v: 3, d: 'a', note: 'Süper 👍' }, { ref: 'P-0002', v: 1, d: 'c', note: null }];
  it('round-trips (unicode notes) and verifies with the pack secret', () => {
    const code = encodeResponse({ packId: 'pack123', items, by: 'Ayşe' }, 'sekret');
    expect(code.startsWith('MDAP1.')).toBe(true);
    const d = verifyResponse(`  ${code.slice(0, 20)}\n${code.slice(20)} `, 'sekret');
    expect(d).toMatchObject({ packId: 'pack123', by: 'Ayşe', items });
  });
  it('the inline browser implementation produces the exact same code and SHA-256 as node:crypto', () => {
    const lib = mdapLib();
    for (const msg of ['', 'abc', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'ü'.repeat(300)]) {
      expect(Buffer.from(lib.sha256(lib.utf8(msg))).toString('hex')).toBe(crypto.createHash('sha256').update(msg, 'utf8').digest('hex'));
    }
    const longKey = 'k'.repeat(100);
    expect(lib.hmacHex(longKey, 'msg')).toBe(crypto.createHmac('sha256', longKey).update('msg').digest('hex'));
    expect(lib.buildCode(CODE_PREFIX, 'pack123', 'sekret', items, 'Ayşe')).toBe(encodeResponse({ packId: 'pack123', items, by: 'Ayşe' }, 'sekret'));
  });
  it('rejects HMAC mismatches, tampering and garbage', () => {
    const code = encodeResponse({ packId: 'pack123', items }, 'sekret');
    expect(() => verifyResponse(code, 'other')).toThrow(expect.objectContaining({ code: 'APPROVAL_CODE_INVALID' }));
    const [p, body, mac] = code.split('.');
    const forged = Buffer.from(JSON.stringify({ packId: 'pack123', items: [{ ...items[0], d: 'c' }], by: null })).toString('base64url');
    expect(() => verifyResponse(`${p}.${forged}.${mac}`, 'sekret')).toThrow();
    expect(() => decodeResponse('hello')).toThrow(expect.objectContaining({ code: 'APPROVAL_CODE_INVALID' }));
    expect(() => decodeResponse(`MDAP1.${Buffer.from('not json').toString('base64url')}.${hmac8('s', 'x')}`)).toThrow();
    expect(body.length).toBeGreaterThan(10);
  });
  it('drops malformed items and clamps notes', () => {
    const code = encodeResponse({ packId: 'p', items: [{ ref: 'P-1', v: 1, d: 'x' }, { ref: 'P-2', v: '1', d: 'a' }, { ref: 'P-3', v: 2, d: 'a', note: 'n'.repeat(5000) }] }, 's');
    const d = decodeResponse(code);
    expect(d.items).toHaveLength(1);
    expect(d.items[0].note).toHaveLength(2000);
  });
});

describe('planImport', () => {
  it('detects stale versions and unknown refs', () => {
    const pack = { items: [{ postId: 1, ref: 'P-0001', version: 3 }, { postId: 2, ref: 'P-0002', version: 1 }, { postId: 3, ref: 'P-0003', version: 1 }] };
    const posts = { 1: { id: 1, version: 3 }, 2: { id: 2, version: 2 } };
    const plan = planImport({ items: [
      { ref: 'P-0001', v: 3, d: 'a', note: null }, { ref: 'P-0002', v: 1, d: 'a', note: null }, { ref: 'P-0003', v: 1, d: 'a', note: null }, { ref: 'P-9999', v: 1, d: 'a', note: null },
    ] }, pack, (id) => posts[id] ?? null);
    expect(plan.apply.map((a) => a.item.ref)).toEqual(['P-0001']);
    expect(plan.stale).toEqual([{ ref: 'P-0002', packVersion: 1, currentVersion: 2 }]);
    expect(plan.unknown).toEqual(['P-0003', 'P-9999']);
  });
});

describe('importResponse (DB)', () => {
  it('applies current decisions with actor client, skips stale ones and writes audit', () => {
    const a = createPost({ title: 'A', caption: 'one', targets: [target()] }, { now: NOW });
    const b = createPost({ title: 'B', caption: 'two', targets: [target()] }, { now: NOW });
    const c = createPost({ title: 'C', caption: 'three', targets: [target()] }, { now: NOW });
    setPostStatus(a, 'in_review');
    setPostStatus(c, 'in_review');
    setPostStatus(c, 'approved');
    const posts = selectPackPosts({ postIds: [a, b, c] });
    const pack = createPackRecord({ posts, title: 'Week 40', clientName: 'Client', lang: 'en', now: NOW });
    expect(getPack(pack.id).items).toHaveLength(3);
    updatePost(b, { caption: 'two, edited' }); // b changes after export → stale
    const [pa, pb, pc] = posts;
    const code = encodeResponse({ packId: pack.id, by: 'Jane Client', items: [
      { ref: pa.ref, v: pa.version, d: 'a', note: 'Looks great' },
      { ref: pb.ref, v: pb.version, d: 'a', note: null },
      { ref: pc.ref, v: pc.version, d: 'c', note: 'Change the photo' },
    ] }, pack.secret);
    const res = importResponse(code, { now: NOW + 1000 });
    expect(res.applied).toEqual([{ ref: pa.ref, decision: 'approved', note: 'Looks great' }, { ref: pc.ref, decision: 'changes_requested', note: 'Change the photo' }]);
    expect(res.stale).toEqual([{ ref: pb.ref, packVersion: pb.version, currentVersion: pb.version + 1 }]);
    expect(res.unknown).toEqual([]);
    expect(res.postIds).toEqual([a, c]);
    const postA = getPost(a);
    expect(postA.status).toBe('approved');
    expect(postA.approvedBy).toBe('Jane Client');
    expect(postA.approvedVersion).toBe(postA.version);
    expect(getPost(b).status).toBe('draft');
    expect(getPost(c).status).toBe('changes_requested');
    const auditA = listAudit({ postId: a });
    expect(auditA.some((e) => e.actor === 'client' && e.action === 'approved')).toBe(true);
    expect(auditA.some((e) => e.actor === 'client' && e.action === 'client_response' && e.detail.packId === pack.id)).toBe(true);
  });
  it('moves drafts through in_review and reports scheduled posts it cannot change', () => {
    const d = createPost({ title: 'D', caption: 'draft', targets: [target()] }, { now: NOW });
    const s = createPost({ title: 'S', caption: 'sched', targets: [target()], status: 'scheduled' }, { now: NOW });
    const posts = selectPackPosts({ postIds: [d, s] });
    const pack = createPackRecord({ posts, now: NOW });
    const code = encodeResponse({ packId: pack.id, items: posts.map((p) => ({ ref: p.ref, v: p.version, d: p.id === d ? 'a' : 'c', note: 'x' })) }, pack.secret);
    const res = importResponse(code);
    expect(getPost(d).status).toBe('approved');
    expect(res.rejected).toEqual([{ ref: posts[1].ref, reason: 'use_publishing' }]);
    expect(getPost(s).status).toBe('scheduled');
    expect(listAudit({ postId: s }).some((e) => e.action === 'client_response' && e.detail.notApplied === 'use_publishing')).toBe(true);
  });
  it('rejects unknown packs and codes signed for another pack', () => {
    expect(() => importResponse(encodeResponse({ packId: 'nope', items: [] }, 'x'))).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    const p = createPost({ title: 'E', caption: 'e', targets: [target()] });
    const pack = createPackRecord({ posts: [getPost(p)] });
    expect(() => importResponse(encodeResponse({ packId: pack.id, items: [] }, 'wrong-secret'))).toThrow(expect.objectContaining({ code: 'APPROVAL_CODE_INVALID' }));
  });
  it('selects posts by range and refuses empty selections', () => {
    const at = NOW + 40 * DAY;
    const id = createPost({ title: 'R', caption: 'range', scheduledAt: at, targets: [target('acc-9')] });
    expect(selectPackPosts({ from: at - 1000, to: at + 1000, accountIds: ['acc-9'] }).map((p) => p.id)).toEqual([id]);
    expect(() => selectPackPosts({ from: at + DAY, to: at + 2 * DAY })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => selectPackPosts({})).toThrow(expect.objectContaining({ code: 'INVALID_PAYLOAD' }));
  });
});
