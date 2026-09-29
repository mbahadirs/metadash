/**
 * Pure helpers for the mdmedia:// protocol (protocol.js):
 *   mdmedia://asset/<id>        → the media file
 *   mdmedia://asset/<id>/thumb  → its thumbnail
 * Only numeric asset ids are accepted; paths never come from the URL.
 */
export const MEDIA_SCHEME = 'mdmedia';

/** @returns {{ assetId: number, variant: 'file'|'thumb' } | null} */
export function parseMediaUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== `${MEDIA_SCHEME}:` || url.hostname !== 'asset') return null;
  const m = /^\/(\d{1,12})(\/thumb)?\/?$/.exec(url.pathname);
  if (!m) return null;
  return { assetId: Number(m[1]), variant: m[2] ? 'thumb' : 'file' };
}

/** URL for an asset (used by the renderer too; keep in sync with lib/types.ts helpers). */
export function mediaUrl(assetId, variant = 'file') {
  return `${MEDIA_SCHEME}://asset/${assetId}${variant === 'thumb' ? '/thumb' : ''}`;
}

/**
 * Parses a single-range `Range: bytes=…` header (video seeking).
 * @returns {{ start: number, end: number } | null | 'invalid'} null = no/ignored range (serve everything)
 */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}
