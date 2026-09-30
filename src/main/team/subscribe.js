import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { closeDb, reopenDb } from '../db/index.js';
import { decryptFile, isEncryptedFile } from './crypto.js';
import { teamError } from './errors.js';
import { manifestPath, snapshotDir, readJson, sha256File } from './folder.js';

/**
 * Subscriber side: pulls the published snapshot into userData/workspaces/<teamId>/data.db and switches the open
 * database to it. Polled (fs.watch is unreliable on cloud folders). A snapshot is only taken once its size and
 * sha256 match the manifest (cloud clients sync files in pieces) and its schema is one this build can open.
 */
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');

/** Highest schema version this build knows (newest migration file). */
export function supportedSchemaVersion() {
  return Math.max(0, ...fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).map((f) => Number.parseInt(f, 10)));
}

export function readManifest(teamDir) {
  const m = readJson(manifestPath(teamDir));
  if (!m?.snapshotId || !m.file || path.basename(String(m.file)) !== m.file) return null;
  return m;
}

export const workspaceDbPath = (workspaceDir) => path.join(workspaceDir, 'data.db');

/** Size + hash check; false while the sync client is still downloading. */
export function snapshotComplete(teamDir, manifest) {
  const file = path.join(snapshotDir(teamDir), manifest.file);
  try {
    if (fs.statSync(file).size !== manifest.size) return false;
  } catch {
    return false;
  }
  return sha256File(file) === manifest.sha256;
}

function checkSqlite(file, supported) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (!head.toString('utf8').startsWith('SQLite format 3')) throw teamError('TEAM_SNAPSHOT_INVALID');
  const db = new Database(file, { readonly: true });
  try {
    const v = db.prepare('SELECT MAX(version) AS v FROM schema_version').get()?.v ?? 0;
    if (v > supported) throw teamError('TEAM_SCHEMA_TOO_NEW');
  } finally {
    db.close();
  }
}

/** Replaces the workspace database with `incoming` and opens it (runs migrations). */
export function swapWorkspaceDb(workspaceDir, incoming) {
  const target = workspaceDbPath(workspaceDir);
  closeDb();
  for (const suffix of ['-wal', '-shm']) fs.rmSync(target + suffix, { force: true });
  fs.renameSync(incoming, target);
  return reopenDb(target);
}

/**
 * One pull. Returns { status, manifest }:
 *   'no_snapshot' | 'unchanged' | 'partial' (still syncing) | 'too_new' (update MetaDash) | 'updated' (DB swapped).
 * Throws TEAM_PASSPHRASE_REQUIRED / TEAM_DECRYPT (wrong key or tampered file) / TEAM_SNAPSHOT_INVALID.
 */
export function pullSnapshot({ teamDir, key = null, workspaceDir, currentSnapshotId = null, force = false }) {
  const manifest = readManifest(teamDir);
  if (!manifest) return { status: 'no_snapshot', manifest: null };
  if (!force && manifest.snapshotId === currentSnapshotId) return { status: 'unchanged', manifest };
  const supported = supportedSchemaVersion();
  if (Number(manifest.schemaVersion) > supported) return { status: 'too_new', manifest, supported };
  if (!snapshotComplete(teamDir, manifest)) return { status: 'partial', manifest };
  fs.mkdirSync(workspaceDir, { recursive: true });
  const src = path.join(snapshotDir(teamDir), manifest.file);
  const incoming = path.join(workspaceDir, `incoming-${process.pid}.db`);
  try {
    if (isEncryptedFile(src)) {
      if (!key) throw teamError('TEAM_PASSPHRASE_REQUIRED');
      decryptFile(src, incoming, key);
    } else {
      fs.copyFileSync(src, incoming);
    }
    checkSqlite(incoming, supported);
  } catch (e) {
    fs.rmSync(incoming, { force: true });
    if (e?.code === 'TEAM_SCHEMA_TOO_NEW') return { status: 'too_new', manifest, supported };
    if (e?.code === 'TEAM_DECRYPT') throw teamError('TEAM_DECRYPT');
    throw e;
  }
  swapWorkspaceDb(workspaceDir, incoming);
  return { status: 'updated', manifest };
}
