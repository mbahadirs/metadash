import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { deriveKey, mediaSignature, safeEqual, isSha256 } from './shared.js';

/**
 * Content-addressed media store: <dataDir>/media/<sha256>. Uploads are streamed to a temp file while hashing and only
 * kept when the hash matches the name. With MD_PUBLIC_URL set, files are served at signed expiring URLs
 * GET /m/<sha256>?exp=<ms>&sig=<hmac> so Meta's crawler can fetch images/videos (Threads, IG images).
 * Pruned 7 days after the last item that used them was published (or removed).
 */
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
export const MEDIA_URL_TTL_MS = 24 * 3_600_000;
export const MEDIA_KEEP_MS = 7 * 24 * 3_600_000;
const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime))$/;

export const isAllowedMime = (m) => typeof m === 'string' && ALLOWED_MIME.test(m);

/** @param {{ dir: string, store: object, getSecret: () => string, publicUrl?: string|null, now?: () => number }} opts */
export function createMediaStore({ dir, store, getSecret, publicUrl = null, now = Date.now }) {
  const root = path.join(dir, 'media');
  const tmpDir = path.join(root, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const base = publicUrl ? publicUrl.replace(/\/+$/, '') : null;

  const pathOf = (sha) => {
    if (!isSha256(sha)) throw Object.assign(new Error('bad sha256'), { code: 'bad_sha' });
    return path.join(root, sha);
  };
  const has = (sha) => isSha256(sha) && !!store.getMedia(sha) && fs.existsSync(pathOf(sha));

  /**
   * Streams `readable` into the store. @returns {Promise<{ sha256, bytes, existed }>}
   * Throws { code: 'too_large' | 'hash_mismatch' }.
   */
  async function put(sha, readable, { mime, maxBytes = MEDIA_MAX_BYTES } = {}) {
    const target = pathOf(sha);
    if (has(sha)) {
      readable.resume?.();
      store.putMedia(sha, { ...store.getMedia(sha), lastUsedAt: now() });
      return { sha256: sha, bytes: store.getMedia(sha).bytes, existed: true };
    }
    const tmp = path.join(tmpDir, `${sha}.${crypto.randomUUID()}`);
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) return cb(Object.assign(new Error('media too large'), { code: 'too_large' }));
        hash.update(chunk);
        return cb(null, chunk);
      },
    });
    try {
      await pipeline(readable, meter, fs.createWriteStream(tmp, { mode: 0o600 }));
      const got = hash.digest('hex');
      if (got !== sha) throw Object.assign(new Error('hash mismatch'), { code: 'hash_mismatch' });
      await fsp.rename(tmp, target);
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    store.putMedia(sha, { mime, bytes, at: now(), lastUsedAt: now() });
    return { sha256: sha, bytes, existed: false };
  }

  const mediaKey = () => deriveKey(getSecret(), 'media');

  /** Signed public URL (null without MD_PUBLIC_URL). */
  function signedUrl(sha, ttlMs = MEDIA_URL_TTL_MS) {
    if (!base) return null;
    const exp = now() + ttlMs;
    return `${base}/m/${sha}?exp=${exp}&sig=${mediaSignature(mediaKey(), sha, exp)}`;
  }

  function verifySigned(sha, exp, sig) {
    if (!isSha256(sha) || !/^\d{10,16}$/.test(String(exp ?? '')) || Number(exp) < now()) return false;
    return safeEqual(mediaSignature(mediaKey(), sha, Number(exp)), sig);
  }

  /** Deletes files not referenced by `keep` and unused for MEDIA_KEEP_MS. @returns number removed */
  async function prune(keep) {
    let removed = 0;
    for (const m of store.listMedia()) {
      if (keep.has(m.sha) || now() - (m.lastUsedAt ?? m.at ?? 0) < MEDIA_KEEP_MS) continue;
      await fsp.rm(pathOf(m.sha), { force: true });
      store.deleteMedia(m.sha);
      removed += 1;
    }
    return removed;
  }

  async function removeAll() {
    for (const m of store.listMedia()) await fsp.rm(pathOf(m.sha), { force: true });
  }

  /** Marks media as used now (keeps it for another MEDIA_KEEP_MS). */
  function touch(sha) {
    const m = store.getMedia(sha);
    if (m) store.putMedia(sha, { ...m, lastUsedAt: now() });
  }

  return { pathOf, has, put, signedUrl, verifySigned, prune, removeAll, touch, publicEnabled: !!base, meta: (sha) => store.getMedia(sha) };
}
