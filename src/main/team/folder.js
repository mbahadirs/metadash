import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Shared-folder layout (Dropbox / iCloud Drive / OneDrive / NAS). Every file has exactly one writer:
 *   <shared>/MetaDash/<teamId>/
 *     team.json                          { teamId, name, formatVersion, createdAt, publisherId, encrypted, kdfSalt, keyCheck }
 *     snapshot/manifest.json             { snapshotId, file, sha256, size, schemaVersion, appVersion, createdAt, publisher }
 *     snapshot/<snapshotId>.metadash[.enc]   last KEEP_SNAPSHOTS kept; manifest replaced last (tmp + rename)
 *     members/<memberId>.json            { id, name, handle, role, updatedAt }
 *     events/<memberId>.jsonl            append-only, written only by that member
 */
export const ROOT_DIR = 'MetaDash';
export const FORMAT_VERSION = 1;
export const KEEP_SNAPSHOTS = 3;

export const teamJsonPath = (dir) => path.join(dir, 'team.json');
export const snapshotDir = (dir) => path.join(dir, 'snapshot');
export const manifestPath = (dir) => path.join(snapshotDir(dir), 'manifest.json');
export const membersDir = (dir) => path.join(dir, 'members');
export const eventsDir = (dir) => path.join(dir, 'events');
export const eventLogPath = (dir, memberId) => path.join(eventsDir(dir), `${memberId}.jsonl`);
export const memberFilePath = (dir, memberId) => path.join(membersDir(dir), `${memberId}.json`);

export function teamDirFor(sharedFolder, teamId) {
  return path.join(sharedFolder, ROOT_DIR, teamId);
}

/**
 * Sync-client duplicates we must never read: Dropbox "(conflicted copy …)", "name (1).ext", iCloud "name 2.ext",
 * OneDrive "name-HOSTNAME.ext" is not detectable in general, so member files must also match their id (see events.js).
 */
export function isConflictedCopy(name) {
  const base = path.basename(String(name));
  return /conflict/i.test(base) || /\(\d+\)/.test(base) || /\s\d+\.[a-z.]+$/i.test(base) || base.startsWith('.');
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Writes via a temp file + fsync + rename so readers (and sync clients) never see a half-written file. */
export function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function writeJsonAtomic(file, obj) {
  writeFileAtomic(file, `${JSON.stringify(obj, null, 2)}\n`);
}

export function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let pos = 0;
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) {
      hash.update(buf.subarray(0, n));
      pos += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Resolves the team directory from what the user picked: the team directory itself (has team.json), the
 * `MetaDash` directory, or the shared root. Returns { dir, team } or throws { code: 'TEAM_NOT_FOUND' | 'TEAM_AMBIGUOUS' }.
 */
export function resolveTeamDir(picked) {
  const tryDir = (d) => { const team = readJson(teamJsonPath(d)); return team?.teamId ? { dir: d, team } : null; };
  const direct = tryDir(picked);
  if (direct) return direct;
  const roots = [path.join(picked, ROOT_DIR), picked];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !isConflictedCopy(e.name)); } catch { continue; }
    const found = entries.map((e) => tryDir(path.join(root, e.name))).filter(Boolean);
    if (found.length === 1) return found[0];
    if (found.length > 1) throw Object.assign(new Error('several teams in folder'), { code: 'TEAM_AMBIGUOUS', teams: found.map((f) => f.team.name) });
  }
  throw Object.assign(new Error('no team in folder'), { code: 'TEAM_NOT_FOUND' });
}
