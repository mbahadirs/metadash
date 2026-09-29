import { getConfig, setConfig, storeToken, readToken, DEFAULTS } from '../../config/store.js';
import { getSetting, setSetting } from '../../db/queries/settings.js';
import { insertUpload, listUploads, markUploadDeleted } from '../../db/queries/planner.js';
import { publishError } from '../errors.js';
import { createS3Host, checkS3Settings } from './s3.js';
import { createUrlHost } from './url.js';
import { createFbPageHost } from './fbPage.js';

/**
 * Media hosts give Meta a public URL for local files (IG images, Threads images/videos). Settings:
 *   planner.mediaHost  { type: 'none'|'s3'|'fbpage'|'url', baseUrl? (url), pageId? (fbpage) }
 *   planner.s3         bucket/endpoint/… (no secrets)
 *   token:planner:s3   encrypted JSON { accessKeyId, secretAccessKey }
 *   planner.mediaHostTest  { ok, at } of the last connection test
 */
export const HOST_TYPES = Object.freeze(['none', 's3', 'fbpage', 'url']);
const CREDENTIALS_REF = 'token:planner:s3';
const LAST_TEST_KEY = 'planner.mediaHostTest';
/** Reuse an existing upload only while its URL stays valid for at least this long (container prep + publish). */
const REUSE_MARGIN_MS = 3 * 3_600_000;

export function readS3Credentials() {
  try { return JSON.parse(readToken(CREDENTIALS_REF) ?? 'null') ?? {}; } catch { return {}; }
}

const hostConfig = () => ({ type: 'none', ...(getConfig('planner.mediaHost') ?? {}) });
const s3Config = () => ({ ...DEFAULTS['planner.s3'], ...(getConfig('planner.s3') ?? {}) });

/** Renderer view (no secrets). */
export function getMediaHostSettings() {
  const cfg = hostConfig();
  const creds = readS3Credentials();
  return {
    type: HOST_TYPES.includes(cfg.type) ? cfg.type : 'none',
    s3: s3Config(),
    keySet: creds.accessKeyId && creds.secretAccessKey ? { last4: String(creds.accessKeyId).slice(-4) } : null,
    baseUrl: cfg.baseUrl ?? '',
    pageId: cfg.pageId ?? '',
  };
}

const S3_FIELDS = { endpoint: 'string', region: 'string', bucket: 'string', prefix: 'string', pathStyle: 'boolean', publicBaseUrl: 'string', urlTtlSec: 'number', deleteAfterPublish: 'boolean' };
const MAX_FIELD = 500;

function cleanS3(input = {}) {
  const out = {};
  for (const [k, t] of Object.entries(S3_FIELDS)) {
    if (input[k] === undefined) continue;
    if (typeof input[k] !== t) throw publishError('pub_invalid_setting', { field: `s3.${k}` });
    out[k] = t === 'string' ? input[k].trim().slice(0, MAX_FIELD) : input[k];
  }
  return out;
}

/** Saves host settings. Credentials are replaced only when both are given; empty strings clear them. */
export function setMediaHostSettings(input = {}) {
  if (!HOST_TYPES.includes(input.type)) throw publishError('pub_invalid_setting', { field: 'type' });
  const s3 = { ...s3Config(), ...cleanS3(input.s3) };
  const cfg = { type: input.type };
  if (typeof input.baseUrl === 'string' && input.baseUrl.trim()) cfg.baseUrl = input.baseUrl.trim().slice(0, MAX_FIELD);
  if (typeof input.pageId === 'string' && /^\d+$/.test(input.pageId.trim())) cfg.pageId = input.pageId.trim();
  if (cfg.type === 'url' && !cfg.baseUrl) throw publishError('pub_url_base_invalid');
  const { accessKeyId, secretAccessKey } = input;
  if (typeof accessKeyId === 'string' && typeof secretAccessKey === 'string') {
    const id = accessKeyId.trim();
    const secret = secretAccessKey.trim();
    storeToken('planner:s3', id && secret ? JSON.stringify({ accessKeyId: id, secretAccessKey: secret }) : '');
  }
  setConfig('planner.s3', s3);
  setConfig('planner.mediaHost', cfg);
  setSetting(LAST_TEST_KEY, null);
  return getMediaHostSettings();
}

/** True when the configured host has everything it needs (S3: bucket + keys). */
export function isHostConfigured() {
  const { type } = getMediaHostSettings();
  if (type === 'none') return false;
  if (type !== 's3') return true;
  try { checkS3Settings(s3Config(), readS3Credentials()); return true; } catch { return false; }
}

export const lastHostTest = () => getSetting(LAST_TEST_KEY, null);
export const recordHostTest = (res, now = Date.now()) => setSetting(LAST_TEST_KEY, { ok: !!res.ok, at: now });

/**
 * The configured host, or null for type 'none'. Throws PublishError when the configuration is incomplete.
 * @param {{ fetchImpl?: typeof fetch, now?: () => number }} [opts]
 */
export function createMediaHost(opts = {}) {
  const cfg = hostConfig();
  if (cfg.type === 's3') return createS3Host({ settings: s3Config(), credentials: readS3Credentials(), ...opts });
  if (cfg.type === 'url') return createUrlHost({ baseUrl: cfg.baseUrl, ...opts });
  if (cfg.type === 'fbpage') return createFbPageHost({ pageId: cfg.pageId, ...opts });
  return null;
}

/**
 * Public URL for one media file, reusing a still-valid upload of the same object.
 * `produceFile()` (instead of filePath) creates the file only when an upload is needed (e.g. JPEG conversion).
 * @param {{ host: object|null, assetId: number, name: string, variant?: string|null, filePath?: string, produceFile?: () => Promise<string>, mime: string,
 *   kind: 'image'|'video', ctx?: object, account?: object, now?: number }} p
 * @returns {Promise<{ url: string, uploadId: number|null }>}
 */
export async function ensureHosted({ host, assetId, name, variant = null, filePath, produceFile, mime, kind, ctx, account, now = Date.now() }) {
  if (!host) throw publishError('pub_host_missing');
  if (kind === 'video' && !host.supportsVideo) throw publishError('pub_host_video_unsupported');
  if (host.persist !== false) {
    const reuse = listUploads({ assetId }).find((u) => u.host === host.type && host.matches(u, name) && (u.expiresAt == null || u.expiresAt > now + REUSE_MARGIN_MS));
    if (reuse) return { url: reuse.publicUrl, uploadId: reuse.id };
  }
  const file = filePath ?? (await produceFile());
  const up = await host.upload({ name, variant, filePath: file, mime, kind, ctx, account });
  if (host.persist === false) return { url: up.publicUrl, uploadId: null };
  const uploadId = insertUpload({ assetId, host: host.type, objectKey: up.objectKey, publicUrl: up.publicUrl, expiresAt: up.expiresAt }, { now });
  return { url: up.publicUrl, uploadId };
}

/** Deletes remote copies (best effort per upload) and marks them deleted. @returns {number} deleted count */
export async function cleanupUploads({ host, uploads, ctx, now = Date.now() }) {
  let n = 0;
  for (const u of uploads) {
    if (!host || u.host !== host.type) continue;
    try {
      await host.cleanup(u, { ctx });
      markUploadDeleted(u.id, now);
      n += 1;
    } catch (e) {
      console.error('[publishing] upload cleanup failed:', u.id, e?.message ?? e);
    }
  }
  return n;
}
