import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { exportAll } from '../export/transfer.js';
import { encryptFile } from './crypto.js';
import {
  snapshotDir, manifestPath, writeJsonAtomic, sha256File, isConflictedCopy, KEEP_SNAPSHOTS,
} from './folder.js';

/**
 * Publisher side: builds a stripped snapshot of the open database and writes it to the shared folder.
 * Base = transfer.exportAll({ passphrase: null }) (drops every token:* secret), then strip further so nothing
 * machine-specific, secret-adjacent or private to the publisher reaches the folder.
 */
/** Settings that travel with the snapshot (everything else is dropped). */
export const SETTINGS_ALLOWLIST = Object.freeze([
  'reportBranding', 'setupComplete', 'setupStep', 'demoMode', 'disabledMetrics', 'refreshTiers', 'mediaLookbackDays',
]);
export const SETTINGS_ALLOW_PREFIXES = Object.freeze(['reportBranding.']);
/** Tables emptied in the snapshot: AI history, sync errors, quota/lease bookkeeping, worker tokens, local marks. */
export const STRIP_TABLES = Object.freeze(['ai_generations', 'sync_errors', 'api_quota', 'locks', 'worker_tokens', 'mention_seen', 'inbox_cursor']);

const allowedSetting = (k) => SETTINGS_ALLOWLIST.includes(k) || SETTINGS_ALLOW_PREFIXES.some((p) => k.startsWith(p));

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

/** Strips a snapshot database file in place. Returns what was removed (for logs/tests). */
export function stripSnapshot(file) {
  const db = new Database(file);
  try {
    db.pragma('foreign_keys = OFF');
    const removed = { settings: 0, tables: {} };
    db.transaction(() => {
      for (const { key } of db.prepare('SELECT key FROM settings').all()) {
        if (!allowedSetting(key)) { db.prepare('DELETE FROM settings WHERE key = ?').run(key); removed.settings += 1; }
      }
      for (const t of STRIP_TABLES) if (tableExists(db, t)) removed.tables[t] = db.prepare(`DELETE FROM ${t}`).run().changes;
      // The outbox: unsent drafts / suggestions / failures stay on the publisher; sent replies are history.
      if (tableExists(db, 'comment_replies')) removed.tables.comment_replies = db.prepare("DELETE FROM comment_replies WHERE status <> 'sent'").run().changes;
      db.prepare("UPDATE profiles SET token_ref = '', refresh_ref = NULL").run();
      if (tableExists(db, 'team_members')) db.prepare('UPDATE team_members SET is_self = 0').run();
    })();
    db.exec('VACUUM');
    return removed;
  } finally {
    db.close();
  }
}

export function schemaVersionOf(file) {
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare('SELECT MAX(version) AS v FROM schema_version').get()?.v ?? 0;
  } finally {
    db.close();
  }
}

const pad = (n) => String(n).padStart(2, '0');
export function newSnapshotId(now = new Date()) {
  const d = now;
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

const SNAPSHOT_RE = /^\d{8}T\d{6}Z-[0-9a-f]{6}\.metadash(\.enc)?$/;

/** Keeps the newest `keep` snapshot files (names sort by time); never touches the one the manifest points at. */
export function pruneSnapshots(teamDir, current, keep = KEEP_SNAPSHOTS) {
  let files = [];
  try { files = fs.readdirSync(snapshotDir(teamDir)); } catch { return []; }
  const snaps = files.filter((f) => SNAPSHOT_RE.test(f) && !isConflictedCopy(f)).sort().reverse();
  const drop = snaps.slice(keep).filter((f) => f !== current);
  for (const f of drop) fs.rmSync(path.join(snapshotDir(teamDir), f), { force: true });
  return drop;
}

/**
 * Exports, strips, optionally encrypts and publishes one snapshot. The snapshot file is written (tmp + fsync +
 * rename) before manifest.json is atomically replaced, so a subscriber never sees a manifest pointing at a
 * missing file. `trace` (tests) records the write order.
 */
export async function publishSnapshot({ teamDir, key = null, appVersion = null, publisher, now = new Date(), trace = null }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-team-'));
  try {
    const plain = path.join(work, 'snapshot.db');
    await exportAll({ filePath: plain, passphrase: null, appVersion });
    stripSnapshot(plain);
    const schemaVersion = schemaVersionOf(plain);
    const snapshotId = newSnapshotId(now);
    const file = `${snapshotId}.metadash${key ? '.enc' : ''}`;
    const dir = snapshotDir(teamDir);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${file}.tmp`);
    if (key) encryptFile(plain, tmp, key);
    else {
      fs.copyFileSync(plain, tmp);
      const fd = fs.openSync(tmp, 'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    fs.renameSync(tmp, path.join(dir, file));
    trace?.push('snapshot');
    const manifest = {
      snapshotId, file, sha256: sha256File(path.join(dir, file)), size: fs.statSync(path.join(dir, file)).size,
      schemaVersion, appVersion, createdAt: now.getTime(), publisher: publisher ?? null, encrypted: !!key,
    };
    writeJsonAtomic(manifestPath(teamDir), manifest);
    trace?.push('manifest');
    pruneSnapshots(teamDir, file);
    return manifest;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
