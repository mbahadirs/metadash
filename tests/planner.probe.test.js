import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseMp4, probeMp4File, matrixRotation } from '../src/main/planner/mp4probe.js';
import { probeImage, probeImageFile } from '../src/main/planner/imageProbe.js';
import { parseMediaUrl, parseRange, mediaUrl } from '../src/main/planner/mediaRequest.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-probe-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// ---- ISO BMFF builders ----------------------------------------------------------------------------------------
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]); };
const full = (type, version, ...parts) => box(type, Buffer.from([version, 0, 0, 0]), ...parts);
const fixed = (n) => u32(Math.round(n * 65536));
const matrix = (a, b, c, d) => Buffer.concat([fixed(a), fixed(b), u32(0), fixed(c), fixed(d), u32(0), u32(0), u32(0), u32(0x40000000)]);

const ftyp = (brand = 'isom') => box('ftyp', Buffer.from(brand, 'latin1'), u32(512), Buffer.from('isomavc1', 'latin1'));
const mvhd = (timescale, duration) => full('mvhd', 0, u32(0), u32(0), u32(timescale), u32(duration), u32(0x00010000), u16(0x0100), Buffer.alloc(10), matrix(1, 0, 0, 1), Buffer.alloc(24), u32(3));
const tkhd = (w, h, m = [1, 0, 0, 1]) => full('tkhd', 0, u32(0), u32(0), u32(1), u32(0), u32(0), Buffer.alloc(8), u16(0), u16(0), u16(0), u16(0), matrix(...m), fixed(w), fixed(h));
const mdhd = (timescale, duration) => full('mdhd', 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0));
const hdlr = (kind) => full('hdlr', 0, u32(0), Buffer.from(kind, 'latin1'), Buffer.alloc(12), Buffer.from('h\0'));
const stsd = (codec) => full('stsd', 0, u32(1), box(codec, Buffer.alloc(6), u16(1), Buffer.alloc(70)));
const stts = (entries) => full('stts', 0, u32(entries.length), ...entries.flatMap(([count, delta]) => [u32(count), u32(delta)]));
const trak = ({ kind, codec, w = 0, h = 0, m, timescale, duration, samples }) => box('trak',
  tkhd(w, h, m),
  box('mdia', mdhd(timescale, duration), hdlr(kind), box('minf', box('stbl', stsd(codec), stts(samples)))));

const videoTrak = (m) => trak({ kind: 'vide', codec: 'avc1', w: 1080, h: 1920, m, timescale: 30000, duration: 30000 * 12, samples: [[360, 1000]] });
const audioTrak = () => trak({ kind: 'soun', codec: 'mp4a', timescale: 44100, duration: 44100 * 12, samples: [[517, 1024]] });
const moov = (m) => box('moov', mvhd(1000, 12_000), videoTrak(m), audioTrak());
const mdat = (bytes) => box('mdat', Buffer.alloc(bytes));

describe('mp4probe', () => {
  it('parses duration, dimensions, codecs and fps with moov at the start', () => {
    const info = parseMp4(Buffer.concat([ftyp(), moov(), mdat(64)]));
    expect(info).toMatchObject({ container: 'mp4', brand: 'isom', durationMs: 12_000, width: 1080, height: 1920, rotation: 0, videoCodec: 'avc1', audioCodec: 'mp4a' });
    expect(info.fps).toBeCloseTo(30, 5);
  });

  it('detects QuickTime and HEVC', () => {
    const hevc = box('moov', mvhd(600, 600 * 5), trak({ kind: 'vide', codec: 'hvc1', w: 1920, h: 1080, timescale: 600, duration: 3000, samples: [[125, 24]] }));
    const info = parseMp4(Buffer.concat([ftyp('qt  '), hevc]));
    expect(info).toMatchObject({ container: 'mov', videoCodec: 'hvc1', audioCodec: null, durationMs: 5000, width: 1920, height: 1080 });
    expect(info.fps).toBeCloseTo(25, 5);
  });

  it('reads the rotation matrix', () => {
    expect(parseMp4(Buffer.concat([ftyp(), moov([0, 1, -1, 0])])).rotation).toBe(90);
    expect(parseMp4(Buffer.concat([ftyp(), moov([-1, 0, 0, -1])])).rotation).toBe(180);
    expect(parseMp4(Buffer.concat([ftyp(), moov([0, -1, 1, 0])])).rotation).toBe(270);
    expect(matrixRotation(1, 0)).toBe(0);
  });

  it('returns null for non-MP4 data and when moov is missing', () => {
    expect(parseMp4(Buffer.from('not a video at all'))).toBeNull();
    expect(parseMp4(Buffer.concat([ftyp(), mdat(16)]))).toBeNull();
  });

  it('probes files with moov at the start and at the end (after a large mdat)', async () => {
    const start = path.join(dir, 'start.mp4');
    const end = path.join(dir, 'end.mp4');
    fs.writeFileSync(start, Buffer.concat([ftyp(), moov(), mdat(1024)]));
    fs.writeFileSync(end, Buffer.concat([ftyp(), mdat(3 * 1024 * 1024), moov([0, 1, -1, 0])]));
    expect(await probeMp4File(start)).toMatchObject({ durationMs: 12_000, rotation: 0, bytes: fs.statSync(start).size });
    expect(await probeMp4File(end)).toMatchObject({ durationMs: 12_000, rotation: 90, width: 1080, height: 1920 });
  });

  it('handles 64-bit box sizes', async () => {
    const big = Buffer.concat([u32(1), Buffer.from('mdat', 'latin1'), u32(0), u32(16 + 8), Buffer.alloc(8)]);
    const file = path.join(dir, 'large.mp4');
    fs.writeFileSync(file, Buffer.concat([ftyp(), big, moov()]));
    expect((await probeMp4File(file)).durationMs).toBe(12_000);
  });
});

// ---- image headers --------------------------------------------------------------------------------------------
const jpeg = ({ w, h, orientation } = {}) => {
  const parts = [Buffer.from([0xff, 0xd8])];
  parts.push(Buffer.from([0xff, 0xe0]), u16(16), Buffer.from('JFIF\0', 'latin1'), Buffer.alloc(9));
  if (orientation) {
    const tiff = Buffer.concat([Buffer.from('MM\0*', 'latin1'), u32(8), u16(1), u16(0x0112), u16(3), u32(1), u16(orientation), u16(0), u32(0)]);
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    parts.push(Buffer.from([0xff, 0xe1]), u16(payload.length + 2), payload);
  }
  parts.push(Buffer.from([0xff, 0xc4]), u16(4), Buffer.alloc(2)); // DHT must not be mistaken for SOF
  parts.push(Buffer.from([0xff, 0xc2]), u16(17), Buffer.from([8]), u16(h), u16(w), Buffer.alloc(10));
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
};
const png = (w, h) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR', 'latin1'), u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0]), u32(0)]);
const le24 = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
const riff = (chunk) => Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'latin1'), chunk]);
const webpX = (w, h) => riff(Buffer.concat([Buffer.from('VP8X', 'latin1'), Buffer.from([10, 0, 0, 0]), Buffer.alloc(4), le24(w - 1), le24(h - 1)]));
const webpL = (w, h) => { const bits = (w - 1) | ((h - 1) << 14); const b = Buffer.alloc(4); b.writeUInt32LE(bits >>> 0); return riff(Buffer.concat([Buffer.from('VP8L', 'latin1'), Buffer.from([5, 0, 0, 0, 0x2f]), b])); };
const webpLossy = (w, h) => { const d = Buffer.alloc(10); d.set([0, 0, 0, 0x9d, 0x01, 0x2a]); d.writeUInt16LE(w, 6); d.writeUInt16LE(h, 8); return riff(Buffer.concat([Buffer.from('VP8 ', 'latin1'), Buffer.from([10, 0, 0, 0]), d])); };

describe('imageProbe', () => {
  it('reads JPEG SOF dimensions (skipping DHT) and EXIF orientation', () => {
    expect(probeImage(jpeg({ w: 1080, h: 1350 }))).toEqual({ format: 'jpeg', mime: 'image/jpeg', width: 1080, height: 1350, rotation: 0 });
    expect(probeImage(jpeg({ w: 4032, h: 3024, orientation: 6 }))).toMatchObject({ width: 4032, height: 3024, rotation: 90 });
    expect(probeImage(jpeg({ w: 4032, h: 3024, orientation: 3 }))).toMatchObject({ rotation: 180 });
  });
  it('reads PNG IHDR', () => {
    expect(probeImage(png(640, 480))).toEqual({ format: 'png', mime: 'image/png', width: 640, height: 480, rotation: 0 });
  });
  it('reads WebP VP8X, VP8L and VP8', () => {
    expect(probeImage(webpX(1200, 628))).toMatchObject({ format: 'webp', width: 1200, height: 628 });
    expect(probeImage(webpL(300, 200))).toMatchObject({ format: 'webp', width: 300, height: 200 });
    expect(probeImage(webpLossy(320, 240))).toMatchObject({ format: 'webp', width: 320, height: 240 });
  });
  it('reads GIF and rejects unknown data', () => {
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([0x40, 0x01, 0xf0, 0x00])]);
    expect(probeImage(gif)).toMatchObject({ format: 'gif', width: 320, height: 240 });
    expect(probeImage(Buffer.from('hello world'))).toBeNull();
    expect(probeImage(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
  it('probes a file from its header only', async () => {
    const file = path.join(dir, 'a.png');
    fs.writeFileSync(file, Buffer.concat([png(10, 20), Buffer.alloc(1000)]));
    expect(await probeImageFile(file)).toMatchObject({ format: 'png', width: 10, height: 20, bytes: 1033 });
  });
});

describe('mdmedia request parsing', () => {
  it('accepts only numeric asset ids', () => {
    expect(parseMediaUrl('mdmedia://asset/12')).toEqual({ assetId: 12, variant: 'file' });
    expect(parseMediaUrl('mdmedia://asset/12/thumb')).toEqual({ assetId: 12, variant: 'thumb' });
    expect(parseMediaUrl(mediaUrl(7, 'thumb'))).toEqual({ assetId: 7, variant: 'thumb' });
    for (const bad of ['mdmedia://asset/../data.db', 'mdmedia://asset/12/../../x', 'mdmedia://file/12', 'file:///etc/passwd', 'mdmedia://asset/abc', 'nonsense']) {
      expect(parseMediaUrl(bad)).toBeNull();
    }
  });
  it('parses byte ranges', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=5-1', 100)).toBe('invalid');
    expect(parseRange('items=1-2', 100)).toBeNull();
  });
});
