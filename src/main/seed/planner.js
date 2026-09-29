import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { q } from '../db/index.js';
import { getMediaRoot } from '../planner/assets.js';
import { createPost, insertAsset, updateTarget, addAudit, getPost } from '../db/queries/planner.js';

/**
 * Demo planner content: drafts, review/approval states, scheduled posts (app mode and FB native), published, partial
 * and failed posts across Instagram, Facebook and Threads. Media are generated gradient PNGs (no binary fixtures).
 */
const DAY = 86_400_000;
const HOUR = 3_600_000;
const LEAD_MS = 5 * 60_000;
const IMAGE_W = 1080;
const IMAGE_H = 1350;
const THUMB_W = 240;
const THUMB_H = 300;
const PALETTES = [[[79, 124, 255], [23, 32, 64]], [[232, 180, 74], [120, 50, 30]], [[63, 191, 143], [16, 60, 70]], [[220, 90, 140], [60, 20, 70]], [[240, 240, 240], [120, 140, 160]]];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Vertical-gradient RGB PNG (rows are uniform, so it deflates to a few KB). */
export function gradientPng(width, height, [top, bottom]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const t = y / Math.max(1, height - 1);
    const rgb = top.map((c, i) => Math.round(c + (bottom[i] - c) * t));
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) raw.set(rgb, row + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function demoAsset(index, now) {
  const palette = PALETTES[index % PALETTES.length];
  const buf = gradientPng(IMAGE_W, IMAGE_H, palette);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const root = getMediaRoot();
  fs.mkdirSync(path.join(root, 'thumbs'), { recursive: true });
  const storedPath = `${sha}.png`;
  const thumbPath = `thumbs/${sha}.png`;
  if (!fs.existsSync(path.join(root, storedPath))) fs.writeFileSync(path.join(root, storedPath), buf);
  if (!fs.existsSync(path.join(root, thumbPath))) fs.writeFileSync(path.join(root, thumbPath), gradientPng(THUMB_W, THUMB_H, palette));
  return insertAsset({ sha256: sha, fileName: `demo-${index + 1}.png`, storedPath, mime: 'image/png', kind: 'image', bytes: buf.length, width: IMAGE_W, height: IMAGE_H, rotation: 0, thumbPath }, { now });
}

function pickAccounts() {
  const rows = q.all('SELECT ig_id AS id, platform FROM accounts WHERE is_tracked = 1 ORDER BY ig_id');
  const of = (p) => rows.filter((r) => r.platform === p).map((r) => r.id);
  return { ig: of('instagram'), fb: of('facebook'), th: of('threads') };
}

const latestMedia = (key) => q.get('SELECT media_id, permalink FROM media WHERE ig_id = ? ORDER BY posted_at DESC LIMIT 1', key);

/** Local-time slot `days` from today at `hour` (machine timezone, like the calendar). */
function slot(now, days, hour) {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  return d.getTime() + days * DAY;
}

function markPublished(target, key, at) {
  const m = latestMedia(key);
  updateTarget(target.id, { state: 'published', remoteId: m?.media_id ?? `demo_${target.id}`, mediaKey: m?.media_id ?? null, permalink: m?.permalink ?? null, publishedAt: at, attempts: 1 });
  addAudit({ postId: target.postId, targetId: target.id, actor: 'worker', action: 'published', detail: { demo: true }, at });
}

function markFailed(target, at, code, message) {
  updateTarget(target.id, { state: 'failed', attempts: 1, lastErrorCode: code, lastError: message });
  addAudit({ postId: target.postId, targetId: target.id, actor: 'worker', action: 'failed', detail: { code, message, demo: true }, at });
}

/** Seeds ~12 planner posts. Skips when there are no tracked demo accounts. @returns {{ posts: number }} */
export function seedPlanner({ now = Date.now() } = {}) {
  const { ig, fb, th } = pickAccounts();
  if (!ig.length) return { posts: 0 };
  const assets = Array.from({ length: 5 }, (_, i) => demoAsset(i, now));
  const media = (...idx) => idx.map((i) => ({ assetId: assets[i].id, role: 'media' }));
  const igT = (i, format = 'image') => ({ accountId: ig[i % ig.length], platform: 'instagram', format });
  const fbT = (format = 'photo', mode = 'app') => (fb.length ? [{ accountId: fb[0], platform: 'facebook', format, mode }] : []);
  const thT = (format = 'text') => (th.length ? [{ accountId: th[0], platform: 'threads', format }] : []);
  const make = (input, status, extra = {}) => {
    const id = createPost({ ...input, status }, { now: now - 3 * DAY, actor: 'system' });
    if (Object.keys(extra).length) q.run('UPDATE planner_posts SET approved_version = ?, approved_by = ?, approved_at = ? WHERE id = ?', extra.approvedVersion ?? null, extra.approvedBy ?? null, extra.approvedAt ?? null, id);
    return getPost(id);
  };
  const queue = (post) => post.targets.forEach((t) => updateTarget(t.id, t.mode === 'native'
    ? { state: 'handed_off', containerId: `demo_fb_${t.id}` }
    : { state: 'queued', nextAttemptAt: post.scheduledAt - (t.format === 'text' ? 0 : LEAD_MS) }));

  make({ title: 'Autumn collection teaser', caption: 'Something new is coming this autumn 🍂 Stay tuned! #newcollection #autumn', targets: [igT(0), ...fbT()], assets: media(0) }, 'draft');
  make({ title: 'Weekend thought', caption: 'What is the one tool you cannot work without? Tell us below 👇', targets: thT(), source: 'manual' }, 'draft');
  make({ title: 'Customer story carousel', caption: 'How @brand helped a small café double its orders ☕️ Swipe through the story →', firstComment: '#smallbusiness #success #cafe', clientName: 'Demo Client', targets: [igT(1, 'carousel')], assets: media(1, 2, 3), scheduledAt: slot(now, 2, 10) }, 'in_review');
  make({ title: 'Price update', caption: 'New prices from next month.', notes: 'Client wants a softer tone.', targets: [igT(2), ...fbT()], assets: media(4), scheduledAt: slot(now, 3, 12) }, 'changes_requested');
  make({ title: 'Team introduction', caption: 'Meet the people behind the product 💙', targets: [igT(0), ...fbT()], assets: media(2), scheduledAt: slot(now, 4, 18) }, 'approved', { approvedVersion: 1, approvedBy: 'Demo Client', approvedAt: now - DAY });
  queue(make({ title: 'Morning offer', caption: 'Good morning! 20% off until noon ☀️ #offer', firstComment: 'Link in bio!', targets: [igT(0), ...fbT()], assets: media(0), scheduledAt: slot(now, 1, 9) }, 'scheduled'));
  queue(make({ title: 'Event reminder (scheduled on Facebook)', caption: 'Reminder: our live Q&A starts tomorrow at 19:00. Bring your questions!', targets: fbT('text', 'native'), scheduledAt: slot(now, 1, 19) }, 'scheduled'));
  queue(make({ title: 'Threads poll', caption: 'Quick one: coffee or tea for a Monday morning?', targets: thT(), scheduledAt: slot(now, 5, 11) }, 'scheduled'));

  const published = make({ title: 'Product launch', caption: 'It is here! Our new product is live 🚀 #launch', targets: [igT(0)], assets: media(1), scheduledAt: slot(now, -2, 18) }, 'published');
  markPublished(published.targets[0], published.targets[0].accountId, published.scheduledAt);
  const partial = make({ title: 'Behind the scenes', caption: 'A look behind the scenes of our photo shoot 📸', targets: [igT(1), ...fbT()], assets: media(3), scheduledAt: slot(now, -3, 13) }, fb.length ? 'partial' : 'published');
  markPublished(partial.targets[0], partial.targets[0].accountId, partial.scheduledAt);
  if (partial.targets[1]) markFailed(partial.targets[1], partial.scheduledAt, '200', 'Missing permission: pages_manage_posts');
  const failed = make({ title: 'Threads image post', caption: 'Our new office view 🌇', targets: thT('image').length ? thT('image') : [igT(2)], assets: media(4), scheduledAt: slot(now, -1, 16) }, 'failed');
  markFailed(failed.targets[0], failed.scheduledAt, 'media_host_missing', 'No media host is configured, so the image could not be given a public URL.');
  make({ title: 'Old idea', caption: 'Summer sale recap', targets: [igT(3)], assets: media(0) }, 'archived');
  return { posts: q.get('SELECT COUNT(*) AS n FROM planner_posts').n };
}
