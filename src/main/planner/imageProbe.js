import fs from 'node:fs/promises';

/**
 * Pure JPEG/PNG/WebP/GIF header parser (dimensions, format, EXIF rotation). Validation never needs nativeImage.
 * @typedef {{ format: 'jpeg'|'png'|'webp'|'gif', mime: string, width: number, height: number, rotation: 0|90|180|270 }} ImageInfo
 */
const HEADER_BYTES = 256 * 1024;
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const EXIF_ROTATION = { 3: 180, 4: 180, 5: 90, 6: 90, 7: 270, 8: 270 };
// SOF markers carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but are not frames.
const isSof = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

const info = (format, width, height, rotation = 0) => (width > 0 && height > 0 ? { format, mime: MIME[format], width, height, rotation } : null);

function exifOrientation(buf, start, end) {
  if (buf.toString('latin1', start, start + 6) !== 'Exif\0\0') return null;
  const tiff = start + 6;
  if (tiff + 8 > end) return null;
  const le = buf.toString('latin1', tiff, tiff + 2) === 'II';
  const r16 = (at) => (le ? buf.readUInt16LE(at) : buf.readUInt16BE(at));
  const r32 = (at) => (le ? buf.readUInt32LE(at) : buf.readUInt32BE(at));
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = r16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (r16(entry) === 0x0112) return r16(entry + 8);
  }
  return null;
}

function probeJpeg(buf) {
  let pos = 2;
  let orientation = null;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) return null;
    const marker = buf[pos + 1];
    if (marker === 0xff) { pos += 1; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { pos += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2) return null;
    if (marker === 0xe1 && orientation == null) orientation = exifOrientation(buf, pos + 4, Math.min(buf.length, pos + 2 + len));
    if (isSof(marker)) {
      if (pos + 9 > buf.length) return null;
      return info('jpeg', buf.readUInt16BE(pos + 7), buf.readUInt16BE(pos + 5), EXIF_ROTATION[orientation] ?? 0);
    }
    pos += 2 + len;
  }
  return null;
}

function probeWebp(buf) {
  const chunk = buf.toString('latin1', 12, 16);
  const d = 20;
  if (chunk === 'VP8X' && buf.length >= d + 10) return info('webp', buf.readUIntLE(d + 4, 3) + 1, buf.readUIntLE(d + 7, 3) + 1);
  if (chunk === 'VP8L' && buf.length >= d + 5 && buf[d] === 0x2f) {
    const bits = buf.readUInt32LE(d + 1);
    return info('webp', (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ' && buf.length >= d + 10 && buf[d + 3] === 0x9d && buf[d + 4] === 0x01 && buf[d + 5] === 0x2a) {
    return info('webp', buf.readUInt16LE(d + 6) & 0x3fff, buf.readUInt16LE(d + 8) & 0x3fff);
  }
  return null;
}

/**
 * @param {Buffer} buf the start of the file (the first 256 KB is enough for any sane JPEG)
 * @returns {ImageInfo|null}
 */
export function probeImage(buf) {
  if (!buf || buf.length < 10) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return probeJpeg(buf);
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return info('png', buf.readUInt32BE(16), buf.readUInt32BE(20));
  }
  if (buf.length >= 16 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return probeWebp(buf);
  const sig = buf.toString('latin1', 0, 6);
  if (sig === 'GIF87a' || sig === 'GIF89a') return info('gif', buf.readUInt16LE(6), buf.readUInt16LE(8));
  return null;
}

/** Reads the first 256 KB of a file and probes it. @returns {Promise<(ImageInfo & { bytes: number })|null>} */
export async function probeImageFile(filePath) {
  const fh = await fs.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    const buf = Buffer.alloc(Math.min(size, HEADER_BYTES));
    await fh.read(buf, 0, buf.length, 0);
    const res = probeImage(buf);
    return res ? { ...res, bytes: size } : null;
  } finally {
    await fh.close();
  }
}
