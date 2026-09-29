import fs from 'node:fs/promises';

/**
 * Pure MP4/MOV (ISO BMFF) metadata parser: duration, display size, rotation, codecs and frame rate.
 * No ffprobe dependency. `probeMp4File` only reads box headers plus the `moov` box, wherever it is in the file.
 */
const VIDEO_CODECS = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01', 'mp4v']);
const AUDIO_CODECS = new Set(['mp4a', 'ac-3', 'ec-3', 'Opus', 'alac', 'lpcm', 'sowt', 'twos']);
const HEADER_READ = 16;
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 10_000;

/** Iterates the boxes in buf[start, end): yields { type, start (payload), end, headerSize }. */
function* boxes(buf, start = 0, end = buf.length) {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) return;
    yield { type, start: pos + header, end: pos + size };
    pos += size;
  }
}

const child = (buf, parent, type) => {
  for (const b of boxes(buf, parent.start, parent.end)) if (b.type === type) return b;
  return null;
};

const children = (buf, parent, type) => [...boxes(buf, parent.start, parent.end)].filter((b) => b.type === type);

/** Degrees (0/90/180/270) from the a/b entries of a tkhd matrix (16.16 fixed point, sign preserved). */
export function matrixRotation(a, b) {
  const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return ((deg % 360) + 360) % 360;
}

/** { timescale, duration } of an mvhd/mdhd full box (version 0 or 1). */
function timeBox(buf, b) {
  const version = buf[b.start];
  if (version === 1) return { timescale: buf.readUInt32BE(b.start + 20), duration: Number(buf.readBigUInt64BE(b.start + 24)) };
  return { timescale: buf.readUInt32BE(b.start + 12), duration: buf.readUInt32BE(b.start + 16) };
}

function parseTkhd(buf, b) {
  const version = buf[b.start];
  const matrixAt = b.start + (version === 1 ? 52 : 40);
  const a = buf.readInt32BE(matrixAt);
  const bb = buf.readInt32BE(matrixAt + 4);
  const width = buf.readUInt32BE(matrixAt + 36) / 65536;
  const height = buf.readUInt32BE(matrixAt + 40) / 65536;
  return { rotation: matrixRotation(a, bb), width: Math.round(width), height: Math.round(height) };
}

function sampleCount(buf, stts) {
  if (!stts) return null;
  const n = buf.readUInt32BE(stts.start + 4);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const at = stts.start + 8 + i * 8;
    if (at + 8 > stts.end) break;
    total += buf.readUInt32BE(at);
  }
  return total;
}

function parseTrak(buf, trak) {
  const tkhd = child(buf, trak, 'tkhd');
  const mdia = child(buf, trak, 'mdia');
  if (!mdia) return null;
  const hdlr = child(buf, mdia, 'hdlr');
  const handler = hdlr ? buf.toString('latin1', hdlr.start + 8, hdlr.start + 12) : null;
  const mdhd = child(buf, mdia, 'mdhd');
  const stbl = child(buf, child(buf, mdia, 'minf') ?? { start: 0, end: 0 }, 'stbl');
  const stsd = stbl ? child(buf, stbl, 'stsd') : null;
  const codec = stsd && stsd.start + 16 <= stsd.end ? buf.toString('latin1', stsd.start + 12, stsd.start + 16) : null;
  const time = mdhd ? timeBox(buf, mdhd) : null;
  const samples = stbl ? sampleCount(buf, child(buf, stbl, 'stts')) : null;
  const fps = time?.duration && samples ? (samples * time.timescale) / time.duration : null;
  return { handler, codec, fps, ...(tkhd ? parseTkhd(buf, tkhd) : { rotation: 0, width: 0, height: 0 }) };
}

/** Parses a `moov` box payload range. */
function parseMoov(buf, moov, brand) {
  const mvhd = child(buf, moov, 'mvhd');
  const time = mvhd ? timeBox(buf, mvhd) : null;
  const tracks = children(buf, moov, 'trak').map((t) => parseTrak(buf, t)).filter(Boolean);
  const video = tracks.find((t) => t.handler === 'vide' || VIDEO_CODECS.has(t.codec));
  const audio = tracks.find((t) => t.handler === 'soun' || AUDIO_CODECS.has(t.codec));
  return {
    container: brand?.trim() === 'qt' ? 'mov' : 'mp4',
    brand: brand?.trim() || null,
    durationMs: time?.timescale ? Math.round((time.duration * 1000) / time.timescale) : null,
    width: video?.width || null,
    height: video?.height || null,
    rotation: video?.rotation ?? 0,
    videoCodec: video?.codec ?? null,
    audioCodec: audio?.codec ?? null,
    fps: video?.fps ?? null,
  };
}

/**
 * Parses an in-memory MP4/MOV. Returns null when the data is not ISO BMFF or has no `moov`.
 * @param {Buffer} buf
 */
export function parseMp4(buf) {
  let brand = null;
  let moov = null;
  for (const b of boxes(buf)) {
    if (b.type === 'ftyp') brand = buf.toString('latin1', b.start, b.start + 4);
    if (b.type === 'moov') moov = b;
  }
  return moov ? parseMoov(buf, moov, brand) : null;
}

/**
 * Probes a file by walking top-level box headers and reading only `ftyp` + `moov`.
 * @returns {Promise<(ReturnType<typeof parseMp4> & { bytes: number }) | null>}
 */
export async function probeMp4File(filePath) {
  const fh = await fs.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    const header = Buffer.alloc(HEADER_READ);
    let pos = 0;
    let brand = null;
    for (let i = 0; i < MAX_TOP_LEVEL_BOXES && pos + 8 <= size; i += 1) {
      const { bytesRead } = await fh.read(header, 0, HEADER_READ, pos);
      if (bytesRead < 8) break;
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      if (i === 0 && type !== 'ftyp' && type !== 'moov' && type !== 'wide' && type !== 'mdat' && type !== 'free') return null;
      if (boxSize === 1) boxSize = bytesRead >= 16 ? Number(header.readBigUInt64BE(8)) : 0;
      else if (boxSize === 0) boxSize = size - pos;
      if (boxSize < 8) return null;
      if (type === 'ftyp') {
        const b = Buffer.alloc(4);
        await fh.read(b, 0, 4, pos + 8);
        brand = b.toString('latin1');
      }
      if (type === 'moov') {
        if (boxSize > MAX_MOOV_BYTES) return null;
        const moovBuf = Buffer.alloc(boxSize);
        await fh.read(moovBuf, 0, boxSize, pos);
        const info = parseMoovBuffer(moovBuf, brand);
        return info ? { ...info, bytes: size } : null;
      }
      pos += boxSize;
    }
    return null;
  } finally {
    await fh.close();
  }
}

function parseMoovBuffer(moovBuf, brand) {
  const [moov] = [...boxes(moovBuf)];
  return moov?.type === 'moov' ? parseMoov(moovBuf, moov, brand) : null;
}
