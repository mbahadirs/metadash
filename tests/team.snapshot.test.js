/**
 * v2.0 F1 team snapshots: strip list, no secrets, MDX1 encryption round trip, manifest-last ordering, partial-file
 * rejection by size/hash, snapshot pruning.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { openDb, closeDb, q } from '../src/main/db/index.js';
import { setSetting } from '../src/main/db/queries/settings.js';
import { storeToken } from '../src/main/config/store.js';
import { publishSnapshot, pruneSnapshots, SETTINGS_ALLOWLIST } from '../src/main/team/publish.js';
import { pullSnapshot, snapshotComplete, readManifest } from '../src/main/team/subscribe.js';
import { encryptFile, decryptFile, deriveKey, newKdfSalt, makeKeyCheck, verifyKeyCheck, isEncryptedFile } from '../src/main/team/crypto.js';
import { snapshotDir, isConflictedCopy } from '../src/main/team/folder.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-team-snap-'));
const teamDir = path.join(dir, 'shared', 'MetaDash', 'team1');

function seed() {
  q.run("INSERT INTO profiles (label, app_id, token_ref, created_at, is_active, refresh_ref) VALUES ('Meta', '123456', 'token:meta:1', 1, 1, 'token:meta:1:r')");
  storeToken('meta:1', 'EAAB-secret-token');
  storeToken('ai:anthropic', 'sk-ant-secret');
  setSetting('reportBranding', { agencyName: 'Acme', accent: '#123456' });
  setSetting('setupComplete', true);
  setSetting('lang', 'tr');
  setSetting('ai.enabled', true);
  setSetting('ui.sidebar', 'wide');
  setSetting('notify.sent', { a: 1 });
  q.run("INSERT INTO accounts (ig_id, profile_id, username, is_tracked, platform, external_id, client_name) VALUES ('1784', 1, 'acme', 1, 'instagram', '1784', 'Acme')");
  q.run("INSERT INTO media (media_id, ig_id, media_type, media_product_type, posted_at, is_deleted) VALUES ('m1', '1784', 'IMAGE', 'FEED', 1, 0)");
  q.run("INSERT INTO comments (comment_id, media_id, username, text, created_at, is_from_owner) VALUES ('c1', 'm1', 'fan', 'hi', 1, 0), ('c2', 'm1', 'fan', 'yo', 2, 0)");
  q.run("INSERT INTO comment_replies (comment_id, suggestion, status, created_at) VALUES ('c1', 'draft', 'suggested', 1)");
  q.run("INSERT INTO comment_replies (comment_id, suggestion, status, sent_text, sent_at, created_at) VALUES ('c2', 'thx', 'sent', 'thx', 3, 2)");
  q.run("INSERT INTO sync_errors (run_id, ig_id, endpoint, message, at) VALUES (NULL, '1784', '/x', 'boom', 1)");
  q.run("INSERT INTO api_quota (provider, day, units) VALUES ('youtube', '2026-01-01', 50)");
  q.run("INSERT INTO worker_tokens (token_key, platform, account_id, status) VALUES ('k1', 'instagram', '1784', 'ok')");
  q.run("INSERT INTO team_members (id, name, handle, role, is_self) VALUES ('me000001', 'Me', 'me', 'admin', 1)");
  q.run("INSERT INTO mention_seen (note_uid, seen_at) VALUES ('n1', 1)");
}

beforeAll(() => {
  openDb(path.join(dir, 'data.db'));
  seed();
});
afterAll(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const openSnap = (manifest) => new Database(path.join(snapshotDir(teamDir), manifest.file), { readonly: true });

describe('team snapshot publish', () => {
  let manifest;
  const trace = [];
  beforeAll(async () => {
    manifest = await publishSnapshot({ teamDir, key: null, appVersion: '2.0.0', publisher: 'Me', trace });
  });

  it('writes the snapshot file before the manifest, and the manifest matches the file', () => {
    expect(trace).toEqual(['snapshot', 'manifest']);
    expect(readManifest(teamDir)).toEqual(manifest);
    expect(snapshotComplete(teamDir, manifest)).toBe(true);
    expect(manifest.schemaVersion).toBeGreaterThanOrEqual(14);
    expect(fs.readdirSync(snapshotDir(teamDir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('never contains a secret (token:*) and keeps only allowlisted settings', () => {
    const db = openSnap(manifest);
    try {
      const keys = db.prepare('SELECT key FROM settings').all().map((r) => r.key);
      expect(keys.some((k) => k.startsWith('token:'))).toBe(false);
      expect(keys.every((k) => SETTINGS_ALLOWLIST.includes(k) || k.startsWith('reportBranding.'))).toBe(true);
      expect(keys).toContain('reportBranding');
      expect(keys).not.toContain('lang');
      expect(keys).not.toContain('ai.enabled');
      const raw = fs.readFileSync(path.join(snapshotDir(teamDir), manifest.file));
      expect(raw.includes(Buffer.from('EAAB-secret-token'))).toBe(false);
      expect(raw.includes(Buffer.from('sk-ant-secret'))).toBe(false);
    } finally { db.close(); }
  });

  it('strips publisher-only tables and blanks token references', () => {
    const db = openSnap(manifest);
    try {
      const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
      for (const t of ['sync_errors', 'api_quota', 'worker_tokens', 'mention_seen', 'ai_generations', 'locks']) expect(n(t)).toBe(0);
      expect(db.prepare('SELECT status FROM comment_replies').all().map((r) => r.status)).toEqual(['sent']);
      expect(db.prepare('SELECT token_ref, refresh_ref FROM profiles').get()).toEqual({ token_ref: '', refresh_ref: null });
      expect(db.prepare('SELECT is_self FROM team_members').get().is_self).toBe(0);
      expect(n('accounts')).toBe(1);
      expect(n('comments')).toBe(2);
    } finally { db.close(); }
  });

  it('leaves the live database untouched', () => {
    expect(q.get("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'token:%'").n).toBeGreaterThan(0);
    expect(q.get('SELECT COUNT(*) AS n FROM sync_errors').n).toBe(1);
  });

  it('rejects a partially synced file by size and by hash', () => {
    const ws = path.join(dir, 'ws-partial');
    const file = path.join(snapshotDir(teamDir), manifest.file);
    const original = fs.readFileSync(file);
    try {
      fs.writeFileSync(file, original.subarray(0, original.length - 10));
      expect(pullSnapshot({ teamDir, workspaceDir: ws }).status).toBe('partial');
      const flipped = Buffer.from(original);
      flipped[flipped.length - 1] ^= 0xff;
      fs.writeFileSync(file, flipped);
      expect(pullSnapshot({ teamDir, workspaceDir: ws }).status).toBe('partial');
      expect(fs.existsSync(path.join(ws, 'data.db'))).toBe(false);
    } finally {
      fs.writeFileSync(file, original);
    }
  });

  it('reports unchanged / no snapshot', () => {
    expect(pullSnapshot({ teamDir, workspaceDir: path.join(dir, 'ws'), currentSnapshotId: manifest.snapshotId }).status).toBe('unchanged');
    expect(pullSnapshot({ teamDir: path.join(dir, 'nowhere'), workspaceDir: path.join(dir, 'ws') }).status).toBe('no_snapshot');
  });

  it('keeps the last three snapshots', () => {
    const sd = snapshotDir(teamDir);
    for (const s of ['20200101T000000Z-aaaaaa', '20200102T000000Z-bbbbbb', '20200103T000000Z-cccccc']) fs.writeFileSync(path.join(sd, `${s}.metadash`), 'x');
    fs.writeFileSync(path.join(sd, '20200101T000000Z-aaaaaa (conflicted copy).metadash'), 'x');
    const dropped = pruneSnapshots(teamDir, manifest.file);
    expect(dropped).toEqual(['20200101T000000Z-aaaaaa.metadash']);
    expect(fs.existsSync(path.join(sd, manifest.file))).toBe(true);
  });
});

describe('snapshot encryption (MDX1)', () => {
  const salt = newKdfSalt();
  const key = deriveKey('correct horse battery', salt);
  const src = path.join(dir, 'plain.bin');
  const enc = path.join(dir, 'cipher.bin');
  const out = path.join(dir, 'roundtrip.bin');
  const data = crypto.randomBytes(5000);
  beforeAll(() => fs.writeFileSync(src, data));

  it('round-trips across several chunks', () => {
    encryptFile(src, enc, key, { chunkSize: 1024 });
    expect(isEncryptedFile(enc)).toBe(true);
    expect(fs.readFileSync(enc).includes(data.subarray(0, 64))).toBe(false);
    decryptFile(enc, out, key);
    expect(fs.readFileSync(out).equals(data)).toBe(true);
  });

  it('round-trips an empty file', () => {
    const empty = path.join(dir, 'empty.bin');
    fs.writeFileSync(empty, '');
    encryptFile(empty, enc, key);
    decryptFile(enc, out, key);
    expect(fs.readFileSync(out).length).toBe(0);
  });

  it('rejects a wrong key, a truncated file and a dropped chunk', () => {
    encryptFile(src, enc, key, { chunkSize: 1024 });
    const wrong = deriveKey('wrong passphrase', salt);
    expect(() => decryptFile(enc, out, wrong)).toThrow(expect.objectContaining({ code: 'TEAM_DECRYPT' }));
    const full = fs.readFileSync(enc);
    const chunkLen = 32 + 1024;
    fs.writeFileSync(enc, full.subarray(0, 8 + chunkLen * 2)); // whole chunks, last flag missing
    expect(() => decryptFile(enc, out, key)).toThrow(expect.objectContaining({ code: 'TEAM_DECRYPT' }));
    fs.writeFileSync(enc, Buffer.concat([full.subarray(0, 8), full.subarray(8 + chunkLen)])); // first chunk dropped
    expect(() => decryptFile(enc, out, key)).toThrow(expect.objectContaining({ code: 'TEAM_DECRYPT' }));
  });

  it('key check tells a wrong passphrase apart', () => {
    const check = makeKeyCheck(key);
    expect(verifyKeyCheck(key, check)).toBe(true);
    expect(verifyKeyCheck(deriveKey('nope nope', salt), check)).toBe(false);
  });

  it('publishes an encrypted snapshot that pulls back with the key only', async () => {
    const encTeam = path.join(dir, 'shared', 'MetaDash', 'team2');
    const manifest = await publishSnapshot({ teamDir: encTeam, key, publisher: 'Me' });
    expect(manifest.file.endsWith('.metadash.enc')).toBe(true);
    const raw = fs.readFileSync(path.join(snapshotDir(encTeam), manifest.file));
    expect(raw.subarray(0, 4).toString()).toBe('MDX1');
    expect(raw.includes(Buffer.from('SQLite format 3'))).toBe(false);
    const ws = path.join(dir, 'ws-enc');
    expect(() => pullSnapshot({ teamDir: encTeam, workspaceDir: ws })).toThrow(expect.objectContaining({ code: 'TEAM_PASSPHRASE_REQUIRED' }));
    expect(() => pullSnapshot({ teamDir: encTeam, workspaceDir: ws, key: deriveKey('bad bad bad', salt) })).toThrow(expect.objectContaining({ code: 'TEAM_DECRYPT' }));
  });
});

describe('conflicted copies', () => {
  it('recognises sync-client duplicates', () => {
    for (const f of ['abc (conflicted copy 2026-01-01).jsonl', 'abc (1).jsonl', 'abc 2.jsonl', "abc (Bahadir's conflicted copy).json", '.abc.jsonl.tmp']) expect(isConflictedCopy(f)).toBe(true);
    for (const f of ['abc.jsonl', '0f3a9c.json', '20260101T000000Z-abcdef.metadash.enc']) expect(isConflictedCopy(f)).toBe(false);
  });
});

