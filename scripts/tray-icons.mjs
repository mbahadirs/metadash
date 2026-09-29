/**
 * Generates resources/tray/* from the geometry of resources/icon-src/icon.svg (bars + trend line):
 *   trayTemplate.png / trayTemplate@2x.png  macOS menu-bar template images (black + alpha, 16 / 32 px)
 *   tray.png / tray@2x.png                  Linux (colour, 32 / 64 px)
 *   tray.ico                                Windows (colour, 16/20/24/32/40/48 px PNG entries)
 * Pure Node (zlib only): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/tray-icons.mjs` or `node scripts/tray-icons.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'tray');
const SS = 8; // supersamples per axis

// ---- geometry (SVG units, 1024 canvas) ---------------------------------------------------------------------------
const BARS = [[268, 560, 104, 196, 30, 0.72], [460, 452, 104, 304, 30, 0.86], [652, 336, 104, 420, 30, 1]];
const LINE = [[292, 452], [512, 346], [704, 238]];
const DOT = [704, 238];

function inRoundRect(px, py, [x, y, w, h, r]) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const dx = Math.max(x + r - px, 0, px - (x + w - r));
  const dy = Math.max(y + r - py, 0, py - (y + h - r));
  return dx * dx + dy * dy <= r * r;
}
function distSeg(px, py, [ax, ay], [bx, by]) {
  const vx = bx - ax; const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}
/** Glyph coverage 0..1 at an SVG point (opacity honoured only when `solid` is false). */
function glyph(px, py, { stroke, dot, solid }) {
  for (const b of BARS) if (inRoundRect(px, py, b)) return solid ? 1 : b[5];
  if (distSeg(px, py, LINE[0], LINE[1]) <= stroke / 2 || distSeg(px, py, LINE[1], LINE[2]) <= stroke / 2) return 1;
  return Math.hypot(px - DOT[0], py - DOT[1]) <= dot ? 1 : 0;
}

const hex = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const STOPS = [[0, hex('#5B8CFF')], [0.55, hex('#6E5CF0')], [1, hex('#C06CE8')]];
function gradient(t) {
  for (let i = 1; i < STOPS.length; i += 1) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) { const f = (t - t0) / (t1 - t0); return c0.map((c, k) => c + (c1[k] - c) * f); }
  }
  return STOPS[STOPS.length - 1][1];
}

/** Renders size×size RGBA. `map(u, v)` converts pixel-space (0..size) to SVG units. */
function render(size, map, shade) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const [gx, gy] = map(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          const [r, g, b, a] = shade(gx, gy);
          acc[0] += r * a; acc[1] += g * a; acc[2] += b * a; acc[3] += a;
        }
      }
      const i = (y * size + x) * 4;
      const a = acc[3] / (SS * SS);
      px[i] = a ? Math.round(acc[0] / acc[3]) : 0;
      px[i + 1] = a ? Math.round(acc[1] / acc[3]) : 0;
      px[i + 2] = a ? Math.round(acc[2] / acc[3]) : 0;
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

/** macOS template: solid black glyph, thicker line for legibility, fitted to the canvas with ~1/16 padding. */
function template(size) {
  const [x0, y0, x1, y1] = [262, 186, 762, 760];
  const scale = (size * 0.9) / Math.max(x1 - x0, y1 - y0);
  const ox = (size - (x1 - x0) * scale) / 2;
  const oy = (size - (y1 - y0) * scale) / 2;
  return render(size, (u, v) => [x0 + (u - ox) / scale, y0 + (v - oy) / scale], (gx, gy) => [0, 0, 0, glyph(gx, gy, { stroke: 64, dot: 58, solid: true })]);
}

/** Colour: the full app icon (gradient rounded square + white glyph), body filling the canvas. */
function colour(size) {
  const scale = size / 824;
  return render(size, (u, v) => [100 + u / scale, 100 + v / scale], (gx, gy) => {
    if (!inRoundRect(gx, gy, [100, 100, 824, 824, 186])) return [0, 0, 0, 0];
    const bg = gradient(((gx - 100) + (gy - 100)) / (2 * 824));
    const g = glyph(gx, gy, { stroke: size <= 24 ? 64 : 48, dot: size <= 24 ? 58 : 48, solid: false });
    return [...bg.map((c) => c + (255 - c) * g), 1];
  });
}

// ---- PNG / ICO encoding --------------------------------------------------------------------------------------------
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(entries) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = entries.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...entries.map((e) => e.data)]);
}

fs.mkdirSync(OUT, { recursive: true });
const write = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log(`${name}  ${buf.length} B`); };
write('trayTemplate.png', png(16, template(16)));
write('trayTemplate@2x.png', png(32, template(32)));
write('tray.png', png(32, colour(32)));
write('tray@2x.png', png(64, colour(64)));
write('tray.ico', ico([16, 20, 24, 32, 40, 48].map((s) => ({ size: s, data: png(s, colour(s)) }))));
