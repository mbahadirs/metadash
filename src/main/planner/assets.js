import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { userDataDir } from '../paths.js';
import { getDbPath } from '../db/index.js';
import { probeImage } from './imageProbe.js';
import { probeMp4File } from './mp4probe.js';
import { insertAsset, getAsset, getAssetBySha, updateAsset, deleteAsset, plannerError } from '../db/queries/planner.js';

/**
 * Planner media library: files are copied to <userData>/planner-media/<sha256>.<ext> (content-addressed, deduped),
 * probed without native code, and get a thumbnail at planner-media/thumbs/<sha256>.jpg when a thumbnailer is injected.
 *
 * makeThumb (injected; electron adapter lives in ipc/planner.handlers.js):
 *   ({ kind: 'image'|'video', filePath, outPath }) → Promise<boolean>   (false = no thumb; the renderer can call setThumb)
 */
const HEADER_BYTES = 256 * 1024;
export const MAX_IMPORT_BYTES = 10 * 1024 ** 3; // FB video limit; everything else is validated later
export const MAX_DATA_URL_BYTES = 25 * 1024 * 1024;
export const MAX_THUMB_BYTES = 2 * 1024 * 1024;
const THUMB_DIR = 'thumbs';
const TMP_DIR = 'tmp';
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', mp4: 'mp4', mov: 'mov' };
const VIDEO_MIME = { mp4: 'video/mp4', mov: 'video/quicktime' };
const THUMB_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;

let mediaRoot = null;

/** Optional override; by default media live next to the open database (<userData>/planner-media in the app). */
export function setMediaRoot(dir) {
  mediaRoot = dir;
}

export function getMediaRoot() {
  if (mediaRoot) return mediaRoot;
  const dbPath = getDbPath();
  return path.join(dbPath ? path.dirname(dbPath) : userDataDir(), 'planner-media');
}

/** Absolute path of a stored relative path; null when it would escape the media root. */
export function resolveStored(rel) {
  if (!rel) return null;
  const root = path.resolve(getMediaRoot());
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

export const assetFilePath = (asset) => resolveStored(asset?.storedPath);
export const assetThumbPath = (asset) => resolveStored(asset?.thumbPath);

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

/** Probes a file: image header first, then MP4/MOV. @returns {Promise<object|null>} normalized probe result */
export async function probeFile(filePath) {
  const fh = await fsp.open(filePath, 'r');
  let head;
  let size;
  try {
    size = (await fh.stat()).size;
    head = Buffer.alloc(Math.min(size, HEADER_BYTES));
    await fh.read(head, 0, head.length, 0);
  } finally {
    await fh.close();
  }
  const img = probeImage(head);
  if (img) return { kind: 'image', format: img.format, mime: img.mime, bytes: size, width: img.width, height: img.height, rotation: img.rotation };
  const vid = await probeMp4File(filePath);
  if (vid) {
    return {
      kind: 'video', format: vid.container, mime: VIDEO_MIME[vid.container], bytes: size, width: vid.width, height: vid.height, rotation: vid.rotation,
      durationMs: vid.durationMs, videoCodec: vid.videoCodec, audioCodec: vid.audioCodec, fps: vid.fps,
    };
  }
  return null;
}

async function ensureDirs() {
  const root = getMediaRoot();
  await fsp.mkdir(path.join(root, THUMB_DIR), { recursive: true });
  await fsp.mkdir(path.join(root, TMP_DIR), { recursive: true });
  return root;
}

async function createThumb(asset, makeThumb) {
  if (!makeThumb) return asset;
  const rel = path.posix.join(THUMB_DIR, `${asset.sha256}.jpg`);
  const outPath = resolveStored(rel);
  try {
    const ok = await makeThumb({ kind: asset.kind, filePath: assetFilePath(asset), outPath });
    return ok ? updateAsset(asset.id, { thumbPath: rel }) : asset;
  } catch (e) {
    console.error('[planner] thumbnail failed:', e?.message ?? e);
    return asset;
  }
}

/**
 * Imports a local file (copy + dedupe + probe + thumb).
 * @returns {Promise<object>} Asset (mapAsset shape)
 */
export async function importFile(srcPath, { makeThumb, now = Date.now() } = {}) {
  const stat = await fsp.stat(srcPath);
  const name = path.basename(srcPath);
  if (!stat.isFile()) throw plannerError('planner_asset_unsupported', 'ASSET_UNSUPPORTED', { name });
  if (stat.size > MAX_IMPORT_BYTES) throw plannerError('planner_asset_too_large', 'ASSET_TOO_LARGE', { mb: Math.round(stat.size / 1024 ** 2) });
  const probe = await probeFile(srcPath);
  if (!probe) throw plannerError('planner_asset_unsupported', 'ASSET_UNSUPPORTED', { name });
  const sha = await sha256File(srcPath);
  const existing = getAssetBySha(sha);
  if (existing && fs.existsSync(assetFilePath(existing))) return existing;
  const root = await ensureDirs();
  const storedPath = `${sha}.${EXT[probe.format]}`;
  const tmp = path.join(root, TMP_DIR, `${sha}.${process.pid}.${Date.now()}.part`);
  await fsp.copyFile(srcPath, tmp);
  await fsp.rename(tmp, path.join(root, storedPath));
  if (existing) return existing; // row existed but the file was missing: restored
  const asset = insertAsset({ sha256: sha, fileName: name, storedPath, ...probe }, { now });
  return createThumb(asset, makeThumb);
}

/** Decodes an image data URL. @returns {{ mime: string, buf: Buffer }} */
export function decodeImageDataUrl(dataUrl, maxBytes = MAX_DATA_URL_BYTES) {
  const m = DATA_URL_RE.exec(String(dataUrl ?? ''));
  if (!m) throw plannerError('planner_invalid_payload', 'INVALID_PAYLOAD', { field: 'dataUrl' });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw plannerError('planner_invalid_payload', 'INVALID_PAYLOAD', { field: 'dataUrl' });
  if (buf.length > maxBytes) throw plannerError('planner_asset_too_large', 'ASSET_TOO_LARGE', { mb: Math.round(buf.length / 1024 ** 2) });
  return { mime: m[1], buf };
}

/** Imports a pasted image (data URL). */
export async function importDataUrl({ name, dataUrl }, { makeThumb, now = Date.now() } = {}) {
  const { buf } = decodeImageDataUrl(dataUrl);
  const probe = probeImage(buf);
  const safeName = path.basename(String(name || 'pasted-image'));
  if (!probe) throw plannerError('planner_asset_unsupported', 'ASSET_UNSUPPORTED', { name: safeName });
  const root = await ensureDirs();
  const tmp = path.join(root, TMP_DIR, `paste-${crypto.randomUUID()}.${EXT[probe.format]}`);
  await fsp.writeFile(tmp, buf);
  try {
    return await importFile(tmp, { makeThumb, now }).then((a) => (a.fileName === path.basename(tmp) ? updateAsset(a.id, { fileName: safeName }) : a));
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

/** Stores a renderer-drawn thumbnail (video frames on Linux, where nativeImage cannot thumbnail videos). */
export async function setThumbFromDataUrl(assetId, dataUrl) {
  const asset = getAsset(assetId);
  if (!asset) throw plannerError('planner_asset_not_found', 'NOT_FOUND');
  const { buf } = decodeImageDataUrl(dataUrl, MAX_THUMB_BYTES);
  const probe = probeImage(buf);
  if (!probe) throw plannerError('planner_invalid_payload', 'INVALID_PAYLOAD', { field: 'dataUrl' });
  await ensureDirs();
  const rel = path.posix.join(THUMB_DIR, `${asset.sha256}.${EXT[probe.format]}`);
  await fsp.writeFile(resolveStored(rel), buf);
  return updateAsset(asset.id, { thumbPath: rel });
}

/** Removes an unused asset (row + files). Throws planner_asset_in_use while referenced. */
export async function removeAsset(assetId) {
  const asset = getAsset(assetId);
  if (!asset) throw plannerError('planner_asset_not_found', 'NOT_FOUND');
  deleteAsset(asset.id);
  for (const p of [assetFilePath(asset), assetThumbPath(asset)]) if (p) await fsp.rm(p, { force: true });
}

/** File + mime for the mdmedia:// protocol; null unless the asset exists and the file is inside the media root. */
export function resolveMediaFile(assetId, variant = 'file') {
  const asset = getAsset(assetId);
  if (!asset) return null;
  const filePath = variant === 'thumb' ? assetThumbPath(asset) : assetFilePath(asset);
  if (!filePath) return null;
  const ext = path.extname(filePath).slice(1);
  const mime = variant === 'thumb' ? THUMB_MIME[ext] : asset.mime;
  return { filePath, mime: mime ?? 'application/octet-stream' };
}
