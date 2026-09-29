import { protocol } from 'electron';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { MEDIA_SCHEME, parseMediaUrl, parseRange } from './planner/mediaRequest.js';
import { resolveMediaFile } from './planner/assets.js';

/**
 * mdmedia:// serves planner media to the renderer (<img>/<video> previews; CSP allows img-src/media-src mdmedia:).
 * Only asset ids are accepted; files are resolved through the DB and must live inside the planner-media directory.
 * Range requests are supported so <video> can seek. CORS is open so the renderer can draw video frames to a canvas
 * (thumbnail fallback) with crossOrigin="anonymous".
 */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

const BASE_HEADERS = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };

const notFound = () => new Response('Not found', { status: 404, headers: BASE_HEADERS });

async function serve(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: BASE_HEADERS });
  const parsed = parseMediaUrl(request.url);
  if (!parsed) return notFound();
  const file = resolveMediaFile(parsed.assetId, parsed.variant);
  if (!file) return notFound();
  let stat;
  try { stat = await fs.promises.stat(file.filePath); } catch { return notFound(); }
  if (!stat.isFile()) return notFound();
  const range = parseRange(request.headers.get('range'), stat.size);
  if (range === 'invalid') return new Response(null, { status: 416, headers: { ...BASE_HEADERS, 'content-range': `bytes */${stat.size}` } });
  const { start, end } = range ?? { start: 0, end: stat.size - 1 };
  const headers = { ...BASE_HEADERS, 'content-type': file.mime, 'content-length': String(end - start + 1) };
  if (range) headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
  const body = request.method === 'HEAD' || stat.size === 0 ? null : Readable.toWeb(fs.createReadStream(file.filePath, { start, end }));
  return new Response(body, { status: range ? 206 : 200, headers });
}

/** Installs the handler (after app ready). */
export function handleMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      return await serve(request);
    } catch (e) {
      console.error('[mdmedia]', e);
      return new Response('Error', { status: 500, headers: BASE_HEADERS });
    }
  });
}
