import fs from 'node:fs';
import { presign, objectUrl, encodeKey, MAX_PRESIGN_SEC } from './sigv4.js';
import { publishError } from '../errors.js';

/**
 * S3-compatible media host (AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi). Files are PUT from main through a
 * presigned URL (no CORS setup needed). Meta gets either `publicBaseUrl + key` (public bucket / CDN) or a presigned GET
 * valid for `urlTtlSec` (max 7 days). VERIFY: Meta fetching query-string presigned URLs — the CDN option exists in case
 * it does not.
 */
const PUT_TTL_SEC = 15 * 60;
const DELETE_TTL_SEC = 5 * 60;
const TEST_TIMEOUT_MS = 20_000;
/** 1×1 white baseline JPEG for the connection test. */
export const TEST_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);

const isLocalHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

/** Normalizes and checks settings + credentials. Throws PublishError('pub_s3_incomplete') when unusable. */
export function checkS3Settings(settings = {}, credentials = {}) {
  const missing = [];
  if (!settings.bucket) missing.push('bucket');
  if (!credentials.accessKeyId) missing.push('accessKeyId');
  if (!credentials.secretAccessKey) missing.push('secretAccessKey');
  if (settings.endpoint) {
    let u;
    try { u = new URL(settings.endpoint); } catch { missing.push('endpoint'); }
    if (u && !(u.protocol === 'https:' || (u.protocol === 'http:' && isLocalHost(u.hostname)))) missing.push('endpoint (https)');
  }
  if (settings.publicBaseUrl) {
    try { if (!/^https?:$/.test(new URL(settings.publicBaseUrl).protocol)) missing.push('publicBaseUrl'); } catch { missing.push('publicBaseUrl'); }
  }
  if (missing.length) throw publishError('pub_s3_incomplete', { fields: missing.join(', ') });
  return {
    endpoint: settings.endpoint || '', region: settings.region || 'us-east-1', bucket: settings.bucket, prefix: settings.prefix ?? '',
    pathStyle: !!settings.pathStyle, publicBaseUrl: (settings.publicBaseUrl || '').replace(/\/+$/, ''),
    urlTtlSec: Math.min(MAX_PRESIGN_SEC, Math.max(600, Number(settings.urlTtlSec) || 86_400)), deleteAfterPublish: settings.deleteAfterPublish !== false,
  };
}

/**
 * @param {{ settings: object, credentials: { accessKeyId: string, secretAccessKey: string }, fetchImpl?: typeof fetch,
 *   now?: () => number, openAsBlob?: (p: string) => Promise<Blob> }} opts
 */
export function createS3Host({ settings, credentials, fetchImpl = (...a) => fetch(...a), now = Date.now, openAsBlob = fs.openAsBlob }) {
  const s = checkS3Settings(settings, credentials);
  const region = s.region === 'auto' ? 'auto' : s.region;
  const sign = (method, key, expiresSec) => presign({
    method, url: objectUrl({ endpoint: s.endpoint, region, bucket: s.bucket, key, pathStyle: s.pathStyle }), region,
    accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey, expiresSec, now: now(),
  });
  const keyFor = (name) => `${s.prefix}${name}`;

  async function put(key, body, mime) {
    const res = await fetchImpl(sign('PUT', key, PUT_TTL_SEC), { method: 'PUT', body, headers: { 'content-type': mime || 'application/octet-stream' } });
    if (!res.ok) throw publishError('pub_s3_upload_failed', { status: res.status }, { kind: res.status >= 500 ? 'transient' : 'config', code: `s3_${res.status}` });
  }

  function publicUrl(key) {
    if (s.publicBaseUrl) return { url: `${s.publicBaseUrl}/${encodeKey(key)}`, expiresAt: null };
    return { url: sign('GET', key, s.urlTtlSec), expiresAt: now() + s.urlTtlSec * 1000 };
  }

  async function remove(key) {
    const res = await fetchImpl(sign('DELETE', key, DELETE_TTL_SEC), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw publishError('pub_s3_delete_failed', { status: res.status }, { kind: 'transient', code: `s3_${res.status}` });
  }

  return {
    type: 's3',
    supportsVideo: true,
    deleteAfterPublish: s.deleteAfterPublish,
    keyFor,
    matches: (upload, name) => upload.objectKey === keyFor(name),
    /** Uploads a local file; returns what planner_uploads stores. */
    async upload({ name, filePath, mime }) {
      const key = keyFor(name);
      await put(key, await openAsBlob(filePath), mime);
      const pub = publicUrl(key);
      return { objectKey: key, publicUrl: pub.url, expiresAt: pub.expiresAt };
    },
    async cleanup(upload) {
      if (upload.objectKey) await remove(upload.objectKey);
    },
    /** Uploads a 1×1 JPEG, fetches it anonymously (expects 200 + image/jpeg), deletes it. */
    async test() {
      const started = now();
      const key = keyFor(`metadash-test-${started}.jpg`);
      let url = null;
      try {
        await put(key, TEST_JPEG, 'image/jpeg');
        url = publicUrl(key).url;
        const res = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
        const type = res.headers?.get?.('content-type') ?? '';
        const ok = res.status === 200 && type.startsWith('image/jpeg');
        return { ok, url, status: res.status, ms: now() - started, ...(ok ? {} : { error: `HTTP ${res.status} ${type}`.trim() }) };
      } catch (e) {
        return { ok: false, url, status: null, ms: now() - started, error: e?.message ?? String(e) };
      } finally {
        await remove(key).catch(() => {});
      }
    },
  };
}
