import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { openDb, closeDb, q } from '../src/main/db/index.js';
import {
  createPost, getPost, updatePost, reschedulePost, duplicatePost, softDeletePost, setPostStatus, listPosts, listAudit, addAudit,
  insertAsset, assetUsage, deleteAsset, updateTarget, leaseTarget, releaseTarget, listTargets, scheduledForAccounts,
  insertUpload, listUploads, markUploadDeleted, insertPack, getPack, setQuota, getQuota,
} from '../src/main/db/queries/planner.js';
import { setMediaRoot, importFile, importDataUrl, setThumbFromDataUrl, removeAsset, resolveMediaFile, resolveStored } from '../src/main/planner/assets.js';
import { msg } from '../src/main/i18n.js';
import { buildSchemaDescription } from '../src/main/ai/ask/schema.js';
import { seedDemo } from '../src/main/seed/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '../src/main/db/migrations');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-planner-'));
const NOW = Date.UTC(2026, 8, 1, 12);
const HOUR = 3_600_000;

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const png = (w, h) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0]), u32(0), Buffer.alloc(64)]);

const igTarget = (extra = {}) => ({ accountId: '17840000', platform: 'instagram', format: 'image', ...extra });
const fbTarget = (extra = {}) => ({ accountId: 'fb-1', platform: 'facebook', format: 'photo', ...extra });

beforeAll(() => {
  // Build a v1.3 database (migrations 001–008) first, then let openDb apply 009 on top of it.
  const dbFile = path.join(dir, 'data.db');
  const raw = new Database(dbFile);
  raw.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER)');
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort()) {
    const v = Number.parseInt(f, 10);
    if (v > 8) continue;
    raw.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    raw.prepare('INSERT INTO schema_version VALUES (?, ?)').run(v, Date.now());
  }
  raw.close();
  openDb(dbFile);
  setMediaRoot(path.join(dir, 'planner-media'));
});
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('migration 009', () => {
  it('applies on top of 008 and creates every planner table', () => {
    expect(q.all('SELECT version FROM schema_version ORDER BY version').map((r) => r.version)).toContain(9);
    const tables = q.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'planner_%'").map((r) => r.name).sort();
    expect(tables).toEqual(['planner_approval_packs', 'planner_assets', 'planner_audit', 'planner_post_assets', 'planner_posts', 'planner_quota', 'planner_targets', 'planner_uploads']);
  });
  it('ask-your-data hides uploads/packs/quota and secret columns but describes posts and targets', () => {
    const text = buildSchemaDescription();
    expect(text).toContain('planner_posts(');
    expect(text).toContain('planner_targets(');
    expect(text).not.toContain('planner_uploads');
    expect(text).not.toContain('planner_approval_packs');
    expect(text).not.toMatch(/secret/i);
  });
});

describe('posts CRUD', () => {
  let asset;
  beforeAll(async () => {
    const file = path.join(dir, 'photo.png');
    fs.writeFileSync(file, png(1080, 1350));
    asset = await importFile(file, { now: NOW });
  });

  it('creates a post with a ref, targets, assets and an audit row', () => {
    const id = createPost({ title: 'Launch', caption: 'Hello', targets: [igTarget(), fbTarget()], assets: [{ assetId: asset.id }], labels: ['promo'] }, { now: NOW });
    const post = getPost(id);
    expect(post).toMatchObject({ ref: `P-${String(id).padStart(4, '0')}`, status: 'draft', version: 1, labels: ['promo'], createdAt: NOW });
    expect(post.targets.map((t) => [t.accountId, t.state, t.mode])).toEqual([['17840000', 'idle', 'app'], ['fb-1', 'idle', 'app']]);
    expect(post.assets).toMatchObject([{ assetId: asset.id, role: 'media', position: 0, asset: { kind: 'image', width: 1080, height: 1350, format: 'png' } }]);
    expect(listAudit({ postId: id }).map((a) => a.action)).toEqual(['created']);
  });

  it('enforces UNIQUE(post, account)', () => {
    expect(() => createPost({ caption: 'dup', targets: [igTarget(), igTarget()] })).toThrow(/UNIQUE/);
  });

  it('bumps version only on content changes', () => {
    const id = createPost({ caption: 'a', targets: [igTarget()], assets: [{ assetId: asset.id }] }, { now: NOW });
    expect(updatePost(id, { title: 'T', notes: 'n', labels: ['x'] }).post.version).toBe(1);
    expect(reschedulePost(id, NOW + 5 * HOUR).version).toBe(1);
    const res = updatePost(id, { caption: 'b' });
    expect(res).toMatchObject({ contentChanged: true, invalidated: false });
    expect(res.post.version).toBe(2);
    expect(updatePost(id, { assets: [{ assetId: asset.id, altText: 'dog' }] }).post.version).toBe(3);
    expect(updatePost(id, { targets: [igTarget({ captionOverride: 'ig only' })] }).post.version).toBe(4);
    expect(updatePost(id, { caption: 'b' }).post.version).toBe(4); // same content
    const actions = listAudit({ postId: id }).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['created', 'edited', 'scheduled']));
  });

  it('detects version conflicts', () => {
    const id = createPost({ caption: 'a', targets: [igTarget()] });
    updatePost(id, { caption: 'b' });
    expect(() => updatePost(id, { caption: 'c' }, { expectedVersion: 1 })).toThrow(expect.objectContaining({ code: 'VERSION_CONFLICT' }));
    expect(updatePost(id, { caption: 'c' }, { expectedVersion: 2 }).post.version).toBe(3);
  });

  it('keeps target rows (and their state) when targets are re-sent; removes and adds by account', () => {
    const id = createPost({ caption: 'a', targets: [igTarget(), fbTarget()] });
    const [ig] = getPost(id).targets;
    updateTarget(ig.id, { state: 'queued', nextAttemptAt: NOW });
    const res = updatePost(id, { targets: [igTarget({ format: 'image' }), { accountId: 'th-1', platform: 'threads', format: 'text' }] });
    expect(res.post.targets.map((t) => t.accountId)).toEqual(['17840000', 'th-1']);
    expect(res.post.targets[0].id).toBe(ig.id);
  });

  it('refuses to drop a target that is handed off / publishing', () => {
    const id = createPost({ caption: 'a', targets: [igTarget(), fbTarget({ mode: 'native' })] });
    updateTarget(getPost(id).targets[1].id, { state: 'handed_off', containerId: '123' });
    expect(() => updatePost(id, { targets: [igTarget()] })).toThrow(expect.objectContaining({ code: 'TARGET_LOCKED' }));
    expect(getPost(id).targets).toHaveLength(2); // rolled back
  });

  it('content edit with requireApproval sends approved/scheduled posts back to review and resets targets', () => {
    const id = createPost({ caption: 'a', targets: [igTarget(), fbTarget({ mode: 'native' })] });
    expect(setPostStatus(id, 'in_review').ok).toBe(true);
    const approved = setPostStatus(id, 'approved', { approver: 'Client', requireApproval: true });
    expect(approved.post).toMatchObject({ status: 'approved', approvedVersion: 1, approvedBy: 'Client' });
    expect(setPostStatus(id, 'scheduled', { requireApproval: true }).ok).toBe(true);
    const [ig, fb] = getPost(id).targets;
    updateTarget(ig.id, { state: 'ready', containerId: 'c1', nextAttemptAt: NOW });
    updateTarget(fb.id, { state: 'handed_off', containerId: 'fbpost' });
    const res = updatePost(id, { caption: 'changed' }, { requireApproval: true });
    expect(res).toMatchObject({ invalidated: true, remoteCancelTargetIds: [fb.id] });
    expect(res.post.status).toBe('in_review');
    expect(res.post.targets[0]).toMatchObject({ state: 'idle', containerId: null });
    expect(listAudit({ postId: id }).map((a) => a.action)).toContain('approval_invalidated');
  });

  it('content edit on a scheduled post without approval keeps it scheduled but drops prepared containers', () => {
    const id = createPost({ caption: 'a', targets: [igTarget()] });
    setPostStatus(id, 'scheduled');
    const [ig] = getPost(id).targets;
    updateTarget(ig.id, { state: 'ready', containerId: 'c1', nextAttemptAt: NOW });
    const res = updatePost(id, { caption: 'b' });
    expect(res.post.status).toBe('scheduled');
    expect(res.post.targets[0]).toMatchObject({ state: 'queued', containerId: null, nextAttemptAt: NOW });
  });

  it('status transitions go through the state machine', () => {
    const id = createPost({ caption: 'a', targets: [igTarget()] });
    expect(setPostStatus(id, 'approved')).toEqual({ ok: false, reason: 'transition_not_allowed' });
    expect(setPostStatus(id, 'scheduled', { requireApproval: true })).toEqual({ ok: false, reason: 'approval_required' });
    expect(setPostStatus(id, 'publishing').ok).toBe(false);
    expect(setPostStatus(999_999, 'draft')).toEqual({ ok: false, reason: 'not_found' });
    expect(setPostStatus(id, 'in_review').ok).toBe(true);
    expect(setPostStatus(id, 'changes_requested', { note: 'fix typo' }).ok).toBe(true);
    const audit = listAudit({ postId: id });
    expect(audit[0]).toMatchObject({ action: 'changes_requested', detail: { from: 'in_review', note: 'fix typo' } });
  });

  it('duplicates into a fresh draft', () => {
    const id = createPost({ caption: 'orig', targets: [igTarget()], assets: [{ assetId: asset.id, altText: 'alt' }] });
    setPostStatus(id, 'in_review');
    const copy = getPost(duplicatePost(id, { scheduledAt: NOW + HOUR }));
    expect(copy).toMatchObject({ caption: 'orig', status: 'draft', source: 'duplicate', scheduledAt: NOW + HOUR, version: 1 });
    expect(copy.assets[0]).toMatchObject({ assetId: asset.id, altText: 'alt' });
    expect(copy.id).not.toBe(id);
  });

  it('soft delete hides the post, cancels pending targets and reports handed-off ones', () => {
    const id = createPost({ caption: 'bye', targets: [igTarget(), fbTarget({ mode: 'native' })] });
    const [ig, fb] = getPost(id).targets;
    updateTarget(ig.id, { state: 'queued' });
    updateTarget(fb.id, { state: 'handed_off' });
    expect(softDeletePost(id, { now: NOW })).toEqual({ handedOffTargetIds: [fb.id] });
    expect(getPost(id)).toBeNull();
    const hidden = getPost(id, { includeDeleted: true });
    expect(hidden.deletedAt).toBe(NOW);
    expect(hidden.targets.map((t) => t.state)).toEqual(['canceled', 'handed_off']);
    expect(listPosts().some((p) => p.id === id)).toBe(false);
  });

  it('refuses to delete a post while a target is publishing', () => {
    const id = createPost({ caption: 'busy', targets: [igTarget()] });
    updateTarget(getPost(id).targets[0].id, { state: 'publishing' });
    expect(() => softDeletePost(id)).toThrow(expect.objectContaining({ code: 'POST_LOCKED' }));
  });
});

describe('listing and worker helpers', () => {
  let a;
  let b;
  let c;
  beforeAll(() => {
    q.run('DELETE FROM planner_post_assets'); q.run('DELETE FROM planner_targets'); q.run('DELETE FROM planner_audit'); q.run('DELETE FROM planner_posts');
    a = createPost({ title: 'Morning 50%', caption: 'coffee', scheduledAt: NOW + HOUR, targets: [igTarget()] });
    b = createPost({ title: 'Evening', caption: 'dinner', scheduledAt: NOW + 10 * HOUR, targets: [fbTarget()] });
    c = createPost({ title: 'Idea', caption: 'someday', targets: [{ accountId: 'th-1', platform: 'threads', format: 'text' }] });
    setPostStatus(c, 'archived');
  });

  it('filters by range, unscheduled, accounts, platforms, statuses and search', () => {
    expect(listPosts().map((p) => p.id)).toEqual([a, b]);
    expect(listPosts({ statuses: ['archived'] }).map((p) => p.id)).toEqual([c]);
    expect(listPosts({ from: NOW, to: NOW + 2 * HOUR }).map((p) => p.id)).toEqual([a]);
    expect(listPosts({ platforms: ['facebook'] }).map((p) => p.id)).toEqual([b]);
    expect(listPosts({ accountIds: ['17840000'] }).map((p) => p.id)).toEqual([a]);
    expect(listPosts({ search: '50%' }).map((p) => p.id)).toEqual([a]);
    expect(listPosts({ search: '%' }).map((p) => p.id)).toEqual([a]);
    const [summary] = listPosts({ accountIds: ['17840000'] });
    expect(summary).toMatchObject({ captionPreview: 'coffee', targets: [{ accountId: '17840000', platform: 'instagram', state: 'idle' }], thumb: null, issuesCount: 0 });
  });

  it('includes unscheduled drafts in a range only when asked', () => {
    const d = createPost({ caption: 'draft', targets: [igTarget()] });
    expect(listPosts({ from: NOW, to: NOW + 2 * HOUR }).map((p) => p.id)).toEqual([a]);
    expect(listPosts({ from: NOW, to: NOW + 2 * HOUR, includeUnscheduled: true }).map((p) => p.id)).toEqual([a, d]);
    softDeletePost(d);
  });

  it('lists scheduled items per account', () => {
    expect(scheduledForAccounts({ accountIds: ['17840000', 'fb-1'] }).map((r) => [r.postId, r.accountId])).toEqual([[a, '17840000'], [b, 'fb-1']]);
  });

  it('leases targets atomically', () => {
    const [t] = getPost(a).targets;
    updateTarget(t.id, { state: 'queued', nextAttemptAt: NOW });
    expect(listTargets({ states: ['queued'], dueBefore: NOW }).map((x) => x.id)).toEqual([t.id]);
    expect(leaseTarget(t.id, 'w1', NOW)).toBe(true);
    expect(leaseTarget(t.id, 'w2', NOW + 1000)).toBe(false);
    expect(leaseTarget(t.id, 'w2', NOW + 601_000)).toBe(true); // stale lease
    releaseTarget(t.id, 'w1');
    expect(getPost(a).targets[0].lockOwner).toBe('w2');
    releaseTarget(t.id, 'w2');
    expect(getPost(a).targets[0].lockOwner).toBeNull();
  });

  it('audit pagination', () => {
    addAudit({ postId: a, actor: 'worker', action: 'queued', detail: { attempt: 1 } });
    const all = listAudit({ postId: a, limit: 50 });
    expect(all[0]).toMatchObject({ actor: 'worker', action: 'queued', detail: { attempt: 1 }, ref: getPost(a).ref });
    expect(listAudit({ postId: a, before: all[0].id }).length).toBe(all.length - 1);
  });

  it('uploads, packs and quota', () => {
    const asset = insertAsset({ sha256: 'f'.repeat(64), storedPath: 'x.jpg', kind: 'image', mime: 'image/jpeg' });
    const up = insertUpload({ assetId: asset.id, host: 's3', objectKey: 'k', publicUrl: 'https://x/k' });
    expect(listUploads({ assetId: asset.id })).toHaveLength(1);
    expect(assetUsage(asset.id)).toEqual({ posts: 0, uploads: 1 });
    expect(() => deleteAsset(asset.id)).toThrow(expect.objectContaining({ code: 'ASSET_IN_USE' }));
    markUploadDeleted(up);
    expect(listUploads({ assetId: asset.id })).toHaveLength(0);
    deleteAsset(asset.id);
    expect(insertPack({ id: 'pk1', items: [{ postId: a, ref: 'P-1', version: 1 }], secret: 's' }).items).toHaveLength(1);
    expect(getPack('pk1').secret).toBe('s');
    expect(setQuota('17840000', { used: 3, total: 100, windowSec: 86400, checkedAt: NOW })).toMatchObject({ used: 3, total: 100 });
    expect(getQuota('nope')).toBeNull();
  });
});

describe('asset library', () => {
  it('imports files content-addressed and dedupes by sha256', async () => {
    const f1 = path.join(dir, 'one.png');
    const f2 = path.join(dir, 'copy.png');
    fs.writeFileSync(f1, png(640, 480));
    fs.copyFileSync(f1, f2);
    const thumbs = [];
    const makeThumb = async ({ kind, outPath }) => { thumbs.push(kind); fs.writeFileSync(outPath, 'x'); return true; };
    const a1 = await importFile(f1, { makeThumb });
    const a2 = await importFile(f2, { makeThumb });
    expect(a2.id).toBe(a1.id);
    expect(thumbs).toEqual(['image']);
    expect(a1).toMatchObject({ kind: 'image', mime: 'image/png', width: 640, height: 480, fileName: 'one.png' });
    expect(a1.storedPath).toBe(`${a1.sha256}.png`);
    expect(fs.existsSync(resolveStored(a1.storedPath))).toBe(true);
    expect(resolveMediaFile(a1.id, 'thumb')).toMatchObject({ mime: 'image/jpeg' });
    expect(resolveMediaFile(a1.id)).toMatchObject({ mime: 'image/png' });
    expect(resolveMediaFile(9_999_999)).toBeNull();
  });

  it('rejects unsupported files', async () => {
    const f = path.join(dir, 'notes.txt');
    fs.writeFileSync(f, 'hello world, not an image');
    await expect(importFile(f)).rejects.toMatchObject({ code: 'ASSET_UNSUPPORTED' });
  });

  it('imports pasted data URLs and stores renderer thumbnails', async () => {
    const dataUrl = `data:image/png;base64,${png(300, 200).toString('base64')}`;
    const asset = await importDataUrl({ name: '../../evil.png', dataUrl });
    expect(asset).toMatchObject({ width: 300, height: 200, fileName: 'evil.png' });
    const withThumb = await setThumbFromDataUrl(asset.id, dataUrl);
    expect(withThumb.thumbPath).toBe(`thumbs/${asset.sha256}.png`);
    await expect(importDataUrl({ name: 'x', dataUrl: 'data:text/html;base64,PGI+' })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
  });

  it('refuses to remove an asset used by a live post, then removes files once unused', async () => {
    const f = path.join(dir, 'used.png');
    fs.writeFileSync(f, png(500, 500));
    const asset = await importFile(f);
    const id = createPost({ caption: 'x', targets: [igTarget()], assets: [{ assetId: asset.id }] });
    await expect(removeAsset(asset.id)).rejects.toMatchObject({ code: 'ASSET_IN_USE' });
    softDeletePost(id);
    await removeAsset(asset.id);
    expect(fs.existsSync(resolveStored(asset.storedPath))).toBe(false);
  });

  it('never resolves paths outside the media root', () => {
    expect(resolveStored('../data.db')).toBeNull();
    expect(resolveStored('/etc/passwd')).toBeNull();
  });
});

describe('planner i18n and demo seed', () => {
  it('main i18n includes planner messages', () => {
    expect(msg('planner_post_not_found', null, 'en')).toBe('Planned post not found.');
    expect(msg('planner_asset_in_use', { n: 2 }, 'tr')).toContain('2 gönderide');
  });
  it('seeds demo planner posts across statuses', () => {
    seedDemo({ reset: true });
    const statuses = new Set(q.all('SELECT status FROM planner_posts').map((r) => r.status));
    expect([...statuses]).toEqual(expect.arrayContaining(['draft', 'in_review', 'approved', 'scheduled', 'published', 'failed']));
    const platforms = new Set(q.all('SELECT platform FROM planner_targets').map((r) => r.platform));
    expect([...platforms].sort()).toEqual(['facebook', 'instagram', 'threads']);
    expect(q.get('SELECT COUNT(*) AS n FROM planner_assets').n).toBeGreaterThan(0);
  });
});
