import fs from 'node:fs';

/**
 * Image preparation for vision prompts: every source is decoded with Electron's nativeImage (injected so tests run in
 * plain Node), downscaled to `maxEdge` on the long side and re-encoded as JPEG under `maxBytes`.
 * Anthropic recommends ≤ 1568 px on the long edge (newer models accept up to 2576 px, at up to ~3× the tokens) and
 * rejects base64 images over 5 MB, so the defaults stay well inside both. Videos are never sent: the asset thumbnail is.
 */
export const VISION_DEFAULTS = Object.freeze({ maxEdge: 1568, maxBytes: 3_500_000, max: 4, qualities: [85, 75, 65, 55], downscaleSteps: 2 });

const FETCH_MAX_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

/** Largest size with the same aspect ratio whose long edge is ≤ maxEdge (never upscales). */
export function fitWithin(w, h, maxEdge) {
  const long = Math.max(w, h);
  if (!long || long <= maxEdge) return { w, h };
  const k = maxEdge / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * Rough per-image input-token estimate (for previews and cost estimates only).
 * - anthropic: w·h/750 (Anthropic vision docs).
 * - openai: 85 base + 170 per 512-px tile after fitting 2048² and scaling the short side to 768; detail 'low' = 85
 *   (gpt-4o-era numbers; VERIFY for gpt-5 / mini models, which use different multipliers).
 * - gemini: 258 tokens for ≤ 384² images, otherwise 258 per 768-px tile (VERIFY).
 * - ollama/other: w·h/750 as a neutral guess (local, no cost).
 */
export function estimateImageTokens(w, h, provider = 'anthropic', { detail = 'auto' } = {}) {
  if (!w || !h) return 0;
  if (provider === 'openai') {
    if (detail === 'low') return 85;
    let { w: fw, h: fh } = fitWithin(w, h, 2048);
    const short = Math.min(fw, fh);
    if (short > 768) { const k = 768 / short; fw = Math.round(fw * k); fh = Math.round(fh * k); }
    return 85 + 170 * Math.ceil(fw / 512) * Math.ceil(fh / 512);
  }
  if (provider === 'gemini') {
    if (w <= 384 && h <= 384) return 258;
    return 258 * Math.ceil(w / 768) * Math.ceil(h / 768);
  }
  return Math.ceil((w * h) / 750);
}

/** Default asset loader: planner media library (videos → their thumbnail). Imported lazily to keep this module light. */
async function defaultLoadAsset(id, variant) {
  const { getAsset } = await import('../db/queries/planner.js');
  const { resolveMediaFile } = await import('../planner/assets.js');
  const asset = getAsset(id);
  if (!asset) return null;
  const file = resolveMediaFile(id, variant);
  return file ? { kind: asset.kind, filePath: file.filePath } : null;
}

async function defaultNativeImage() {
  const electron = await import('electron');
  return electron.nativeImage ?? electron.default?.nativeImage;
}

function normalizeSource(src) {
  if (typeof src === 'number' || (typeof src === 'string' && /^\d+$/.test(src))) return { assetId: Number(src) };
  return src && typeof src === 'object' ? src : {};
}

async function fetchImageBuffer(url, fetchImpl) {
  if (!/^https:\/\//i.test(url)) return null;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length <= FETCH_MAX_BYTES ? buf : null;
}

/** Decodes one source into a nativeImage; returns { image, source } or { reason }. */
async function decode(src, { nativeImage, loadAsset, fetchImpl }) {
  if (src.assetId != null) {
    const id = Number(src.assetId);
    let asset = await loadAsset(id, 'file');
    if (!asset) return { reason: 'not_found', source: { kind: 'asset', id } };
    const variant = asset.kind === 'video' || src.variant === 'thumb' ? 'thumb' : 'file';
    if (variant === 'thumb') asset = await loadAsset(id, 'thumb');
    if (!asset?.filePath) return { reason: 'not_found', source: { kind: 'asset', id } };
    return { image: nativeImage.createFromPath(asset.filePath), source: { kind: 'asset', id, variant } };
  }
  if (src.path) return { image: nativeImage.createFromPath(src.path), source: { kind: 'path' } };
  if (src.dataUrl) {
    const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(src.dataUrl);
    if (!m) return { reason: 'unsupported' };
    return { image: nativeImage.createFromBuffer(Buffer.from(m[2], 'base64')), source: { kind: 'data' } };
  }
  if (src.url) {
    const buf = await fetchImageBuffer(src.url, fetchImpl);
    if (!buf) return { reason: 'unreadable', source: { kind: 'url' } };
    return { image: nativeImage.createFromBuffer(buf), source: { kind: 'url', mediaId: src.mediaId ?? null } };
  }
  return { reason: 'unsupported' };
}

/** Re-encodes as JPEG, lowering quality and then halving the size until it fits maxBytes. */
function encode(image, { maxEdge, maxBytes, qualities, downscaleSteps }) {
  const size = image.getSize();
  let { w, h } = fitWithin(size.width, size.height, maxEdge);
  for (let step = 0; step <= downscaleSteps; step += 1) {
    const resized = w === size.width && h === size.height ? image : image.resize({ width: w, height: h, quality: 'good' });
    for (const q of qualities) {
      const buf = resized.toJPEG(q);
      if (buf.length <= maxBytes) return { buf, w, h };
    }
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
  }
  return null;
}

/**
 * sources: asset ids (number) | { assetId, variant? } | { path } | { dataUrl } | { url (https only), mediaId? }.
 * Returns { images: [{ mime:'image/jpeg', data (base64), w, h, bytes, source }], skipped: [{ source, reason }] }
 * with at most `max` images; reasons: not_found | unreadable | unsupported | too_large | over_limit.
 */
export async function prepareImages(sources = [], opts = {}) {
  const o = { ...VISION_DEFAULTS, ...opts };
  const nativeImage = o.nativeImage ?? (await defaultNativeImage());
  const deps = { nativeImage, loadAsset: o.loadAsset ?? defaultLoadAsset, fetchImpl: o.fetchImpl ?? fetch };
  const images = [];
  const skipped = [];
  for (const raw of Array.isArray(sources) ? sources : []) {
    const src = normalizeSource(raw);
    if (images.length >= o.max) { skipped.push({ source: raw, reason: 'over_limit' }); continue; }
    let decoded;
    try {
      if (src.path && !fs.existsSync(src.path) && !o.nativeImage) { skipped.push({ source: raw, reason: 'unreadable' }); continue; }
      decoded = await decode(src, deps);
    } catch {
      decoded = { reason: 'unreadable' };
    }
    if (!decoded.image || decoded.image.isEmpty()) { skipped.push({ source: raw, reason: decoded.reason ?? 'unreadable' }); continue; }
    const enc = encode(decoded.image, o);
    if (!enc) { skipped.push({ source: raw, reason: 'too_large' }); continue; }
    images.push({ mime: 'image/jpeg', data: enc.buf.toString('base64'), w: enc.w, h: enc.h, bytes: enc.buf.length, source: decoded.source });
  }
  return { images, skipped };
}

/** Counts-only summary of prepared images, safe for ai_generations.sent_summary. */
export function imageSummary(images = []) {
  return { images: images.length, imageBytes: images.reduce((s, i) => s + (i.bytes ?? 0), 0) };
}
