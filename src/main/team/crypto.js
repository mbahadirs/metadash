import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Optional encryption of team snapshots ("MDX1"): AES-256-GCM over 1 MB chunks, key = scrypt(team passphrase,
 * team.json kdfSalt). Layout:
 *   "MDX1" | u32 chunkSize | { iv(12) | u32 length | tag(16) | ciphertext }*
 * Each chunk authenticates its index and a "last chunk" flag (AAD), so reordered, dropped or truncated chunks fail.
 * team.json keeps `keyCheck` = HMAC(key, KEY_CHECK_LABEL) so a wrong passphrase is reported before any download.
 * This protects the shared folder; a machine where the snapshot is unlocked has the data in clear (docs/team.md).
 */
export const MAGIC = Buffer.from('MDX1');
export const CHUNK_SIZE = 1024 * 1024;
const KEY_CHECK_LABEL = 'metadash-team-keycheck-v1';
const SCRYPT = { N: 16384, r: 8, p: 1 };

const decryptError = () => Object.assign(new Error('snapshot decryption failed'), { code: 'TEAM_DECRYPT' });

export const newKdfSalt = () => crypto.randomBytes(16).toString('base64');

export function deriveKey(passphrase, saltB64) {
  if (!passphrase) throw Object.assign(new Error('passphrase required'), { code: 'TEAM_PASSPHRASE_REQUIRED' });
  return crypto.scryptSync(String(passphrase), Buffer.from(saltB64, 'base64'), 32, SCRYPT);
}

export function makeKeyCheck(key) {
  return crypto.createHmac('sha256', key).update(KEY_CHECK_LABEL).digest('base64');
}

export function verifyKeyCheck(key, check) {
  const a = Buffer.from(makeKeyCheck(key));
  const b = Buffer.from(String(check ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const aad = (index, last) => {
  const b = Buffer.alloc(5);
  b.writeUInt32BE(index, 0);
  b.writeUInt8(last ? 1 : 0, 4);
  return b;
};

export function isEncryptedFile(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(4);
    return fs.readSync(fd, head, 0, 4, 0) === 4 && head.equals(MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

/** Encrypts `src` into `dest` (streamed; memory stays at one chunk). */
export function encryptFile(src, dest, key, { chunkSize = CHUNK_SIZE } = {}) {
  const size = fs.statSync(src).size;
  const inFd = fs.openSync(src, 'r');
  const outFd = fs.openSync(dest, 'w');
  try {
    const header = Buffer.alloc(8);
    MAGIC.copy(header, 0);
    header.writeUInt32BE(chunkSize, 4);
    fs.writeSync(outFd, header);
    const buf = Buffer.alloc(chunkSize);
    let pos = 0;
    let index = 0;
    do {
      const n = fs.readSync(inFd, buf, 0, chunkSize, pos);
      pos += n;
      const last = pos >= size;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(index, last));
      const ct = Buffer.concat([cipher.update(buf.subarray(0, n)), cipher.final()]);
      const meta = Buffer.alloc(4);
      meta.writeUInt32BE(ct.length, 0);
      fs.writeSync(outFd, Buffer.concat([iv, meta, cipher.getAuthTag(), ct]));
      index += 1;
      if (last) break;
    } while (true);
    fs.fsyncSync(outFd);
  } finally {
    fs.closeSync(inFd);
    fs.closeSync(outFd);
  }
}

/** Decrypts an MDX1 file; throws { code: 'TEAM_DECRYPT' } on a wrong key or any tampering/truncation. */
export function decryptFile(src, dest, key) {
  const size = fs.statSync(src).size;
  const inFd = fs.openSync(src, 'r');
  const outFd = fs.openSync(dest, 'w');
  try {
    const header = Buffer.alloc(8);
    if (fs.readSync(inFd, header, 0, 8, 0) !== 8 || !header.subarray(0, 4).equals(MAGIC)) throw decryptError();
    const chunkSize = header.readUInt32BE(4);
    let pos = 8;
    let index = 0;
    let sawLast = false;
    const head = Buffer.alloc(32);
    while (pos < size) {
      if (fs.readSync(inFd, head, 0, 32, pos) !== 32) throw decryptError();
      const len = head.readUInt32BE(12);
      if (len > chunkSize) throw decryptError();
      const ct = Buffer.alloc(len);
      if (fs.readSync(inFd, ct, 0, len, pos + 32) !== len) throw decryptError();
      pos += 32 + len;
      const last = pos >= size;
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, head.subarray(0, 12));
      decipher.setAAD(aad(index, last));
      decipher.setAuthTag(head.subarray(16, 32));
      let plain;
      try {
        plain = Buffer.concat([decipher.update(ct), decipher.final()]);
      } catch {
        throw decryptError();
      }
      fs.writeSync(outFd, plain);
      index += 1;
      sawLast = last;
    }
    if (!sawLast) throw decryptError();
  } finally {
    fs.closeSync(inFd);
    fs.closeSync(outFd);
  }
}
