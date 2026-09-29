import fs from 'node:fs';
import path from 'node:path';
import { nativeImage } from 'electron';
import { checkLogo, MAX_LOGO_BYTES } from './branding.js';
import { msg } from '../i18n.js';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };
const MAX_WIDTH = 800;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/** Downscales large raster logos (≤ 800 px wide) so they fit the 1 MB limit; SVG/undecodable files pass through. */
function shrink(buf, mime) {
  if (mime === 'image/svg+xml') return { buf, mime };
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return { buf, mime };
  const { width } = img.getSize();
  if (width <= MAX_WIDTH && buf.length <= MAX_LOGO_BYTES) return { buf, mime };
  const small = img.resize({ width: Math.min(width, MAX_WIDTH), quality: 'best' });
  return mime === 'image/jpeg' ? { buf: small.toJPEG(85), mime } : { buf: small.toPNG(), mime: 'image/png' };
}

/** Reads an image file into a validated data URL ({ name, dataUrl }); throws a localized error when unusable. */
export function readLogoFile(file) {
  const mime = MIME[path.extname(file).slice(1).toLowerCase()];
  if (!mime) throw new Error(msg('logo_invalid'));
  if (fs.statSync(file).size > MAX_SOURCE_BYTES) throw new Error(msg('logo_too_large'));
  const out = shrink(fs.readFileSync(file), mime);
  const dataUrl = `data:${out.mime};base64,${out.buf.toString('base64')}`;
  const r = checkLogo(dataUrl);
  if (!r.ok) throw new Error(msg(r.error));
  return { name: path.basename(file), dataUrl };
}
