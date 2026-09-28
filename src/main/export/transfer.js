import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { getDb, getDbPath, closeDb, reopenDb } from '../db/index.js';
import { decryptString, encryptString } from '../config/store.js';
import { msg } from '../i18n.js';

/**
 * Full data transfer between installs. The file is a SQLite snapshot of the database with:
 *  - leftover rows from the retired licensing system removed,
 *  - secrets (Meta token, App Secret) re-encrypted with a passphrase ("pp:" prefix) or dropped when no passphrase is given.
 * On import secrets are re-encrypted with this machine's key.
 */
const PP_PREFIX = 'pp:';
// Settings written by pre-1.0 builds that shipped a licensing system; never exported or imported.
const LEGACY_LICENSE_SQL = "DELETE FROM settings WHERE key = 'token:license' OR key LIKE 'license.%'";
const isSecretKey = (k) => k.startsWith('token:') && k !== 'token:license';
// settings.value is JSON-encoded (see queries/settings.js); read/write through these helpers
const parseVal = (v) => { try { return JSON.parse(v); } catch { return v; } };
const encodeVal = (v) => JSON.stringify(v);

function ppKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}
function ppEncrypt(text, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ppKey(passphrase, salt), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return PP_PREFIX + Buffer.concat([salt, iv, cipher.getAuthTag(), enc]).toString('base64');
}
function ppDecrypt(stored, passphrase) {
  const buf = Buffer.from(stored.slice(PP_PREFIX.length), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ppKey(passphrase, buf.subarray(0, 16)), buf.subarray(16, 28));
  decipher.setAuthTag(buf.subarray(28, 44));
  return Buffer.concat([decipher.update(buf.subarray(44)), decipher.final()]).toString('utf8');
}

function counts(db) {
  const c = (sql) => { try { return db.prepare(sql).get().n; } catch { return 0; } };
  return {
    accounts: c('SELECT COUNT(*) AS n FROM accounts'), media: c('SELECT COUNT(*) AS n FROM media'), snapshots: c('SELECT COUNT(*) AS n FROM account_snapshots'),
    insights: c('SELECT COUNT(*) AS n FROM account_insights_daily'), adAccounts: c('SELECT COUNT(*) AS n FROM ad_accounts'), adRows: c('SELECT COUNT(*) AS n FROM ad_insights_daily'),
    stories: c('SELECT COUNT(*) AS n FROM stories'), competitors: c('SELECT COUNT(*) AS n FROM competitors'), notes: c('SELECT COUNT(*) AS n FROM notes'), tags: c('SELECT COUNT(*) AS n FROM tags'),
  };
}

export async function exportAll({ filePath, passphrase, appVersion }) {
  const tmp = path.join(os.tmpdir(), `metadash-export-${Date.now()}.db`);
  await getDb().backup(tmp);
  const db = new Database(tmp);
  try {
    db.pragma('journal_mode = DELETE');
    db.exec(LEGACY_LICENSE_SQL);
    const secrets = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'token:%'").all().filter((r) => isSecretKey(r.key));
    let kept = 0;
    let dropped = 0;
    for (const row of secrets) {
      const plain = decryptString(parseVal(row.value));
      if (plain && passphrase) { db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(encodeVal(ppEncrypt(plain, passphrase)), row.key); kept += 1; }
      else { db.prepare('DELETE FROM settings WHERE key = ?').run(row.key); dropped += 1; }
    }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('transfer.meta', encodeVal({ exportedAt: Date.now(), appVersion, host: os.hostname(), secrets: kept > 0, format: 1 }));
    const summary = counts(db);
    db.exec('VACUUM');
    db.close();
    fs.copyFileSync(tmp, filePath);
    return { filePath, secretsKept: kept, secretsDropped: dropped, size: fs.statSync(filePath).size, ...summary };
  } finally {
    try { db.open && db.close(); } catch { /* ignore */ }
    fs.rmSync(tmp, { force: true });
    fs.rmSync(`${tmp}-journal`, { force: true });
  }
}

/** Reads a transfer file without touching the live database. */
export function inspectTransfer(filePath) {
  const header = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (!header.toString('utf8').startsWith('SQLite format 3')) throw new Error(msg('not_transfer'));
  const db = new Database(filePath, { readonly: true });
  try {
    const hasSchema = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get().n > 0;
    if (!hasSchema) throw new Error(msg('no_tables_in_file'));
    const metaRow = db.prepare("SELECT value FROM settings WHERE key = 'transfer.meta'").get();
    const meta = metaRow ? parseVal(metaRow.value) : null;
    const secretRows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'token:%'").all().filter((r) => isSecretKey(r.key));
    const needsPassphrase = secretRows.some((r) => String(parseVal(r.value)).startsWith(PP_PREFIX));
    const schemaVersion = db.prepare('SELECT MAX(version) AS v FROM schema_version').get()?.v ?? null;
    return { meta, needsPassphrase, secretCount: secretRows.length, schemaVersion, ...counts(db), size: fs.statSync(filePath).size };
  } finally {
    db.close();
  }
}

export function importAll({ filePath, passphrase }) {
  const info = inspectTransfer(filePath);
  if (info.needsPassphrase) {
    if (!passphrase) throw Object.assign(new Error(msg('passphrase_required')), { code: 'PASSPHRASE_REQUIRED' });
    const probe = new Database(filePath, { readonly: true });
    try {
      const row = probe.prepare("SELECT value FROM settings WHERE key LIKE 'token:%'").all().map((r) => parseVal(r.value)).find((v) => String(v).startsWith(PP_PREFIX));
      try { ppDecrypt(row, passphrase); } catch { throw Object.assign(new Error(msg('passphrase_wrong')), { code: 'PASSPHRASE_WRONG' }); }
    } finally { probe.close(); }
  }
  const live = getDb();
  const target = getDbPath();
  closeDb();
  const keep = `${target}.pre-import-${Date.now()}`;
  fs.copyFileSync(target, keep);
  for (const suffix of ['-wal', '-shm']) fs.rmSync(target + suffix, { force: true });
  fs.copyFileSync(filePath, target);
  const db = reopenDb(); // runs pending migrations on the imported file
  const tx = db.transaction(() => {
    db.exec(LEGACY_LICENSE_SQL);
    const secrets = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'token:%'").all().filter((r) => isSecretKey(r.key));
    for (const s of secrets) {
      const v = String(parseVal(s.value));
      if (v.startsWith(PP_PREFIX)) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(encodeVal(encryptString(ppDecrypt(v, passphrase))), s.key);
      else if (v.startsWith('gcm:') && decryptString(v) == null) db.prepare('DELETE FROM settings WHERE key = ?').run(s.key); // encrypted for another machine → unusable
    }
    db.prepare("DELETE FROM settings WHERE key = 'transfer.meta'").run();
  });
  tx();
  return { importedFrom: filePath, previousCopy: keep, ...counts(db), secretsRestored: info.needsPassphrase ? info.secretCount : 0 };
}
