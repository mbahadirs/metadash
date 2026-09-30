/**
 * v2.0 F1 publisher → subscriber round trip in one process (the DB is a singleton, so the two installs take turns):
 * create/join, DB swap keeps local.db settings, schema too new blocks the import, restart restores subscriber mode,
 * subscriber notes travel back to the publisher as events, leave returns to the own database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb, closeDb, getDbPath, getDb, q } from '../src/main/db/index.js';
import { getSetting, setSetting, hasLocalSettingsStore } from '../src/main/db/queries/settings.js';
import { storeToken } from '../src/main/config/store.js';
import {
  initTeam, setIdentity, createTeam, joinTeam, leaveTeam, publishNow, pullNow, getTeamState, getTeamConfig, __resetTeamForTests, localDbPath,
} from '../src/main/team/index.js';
import { getSession } from '../src/main/team/session.js';
import { addNoteV2 } from '../src/main/team/notes.js';
import { snapshotDir, manifestPath, sha256File, writeJsonAtomic } from '../src/main/team/folder.js';
import { readManifest, supportedSchemaVersion } from '../src/main/team/subscribe.js';
import { check } from '../src/main/team/policy.js';
import { msg } from '../src/main/i18n.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-team-sub-'));
const shared = path.join(root, 'Dropbox');
const pubHome = path.join(root, 'publisher', 'data.db');
const subHome = path.join(root, 'subscriber', 'data.db');
fs.mkdirSync(shared, { recursive: true });

async function asInstall(home) {
  __resetTeamForTests();
  closeDb();
  openDb(home);
  await initTeam();
}

/** Writes a hand-made snapshot (plain) and points the manifest at it, like a publisher would. */
async function fakeSnapshot(teamDir, mutate, { schemaVersion } = {}) {
  const prev = readManifest(teamDir);
  const id = `2099010${Math.floor(Math.random() * 9)}T000000Z-${Math.random().toString(16).slice(2, 8)}`;
  const file = `${id}.metadash`;
  const target = path.join(snapshotDir(teamDir), file);
  await getDb().backup(target); // the published file is encrypted; start from the current workspace copy
  const db = new Database(target);
  mutate(db);
  db.close();
  writeJsonAtomic(manifestPath(teamDir), { ...prev, snapshotId: id, file, sha256: sha256File(target), size: fs.statSync(target).size, schemaVersion: schemaVersion ?? prev.schemaVersion, createdAt: Date.now() });
  return id;
}

let teamDir;

beforeAll(async () => {
  await asInstall(pubHome);
  q.run("INSERT INTO profiles (label, app_id, token_ref, created_at, is_active) VALUES ('Meta', '123456', 'token:meta:1', 1, 1)");
  storeToken('meta:1', 'EAAB-secret');
  q.run("INSERT INTO accounts (ig_id, profile_id, username, is_tracked, platform, external_id, client_name) VALUES ('1784', 1, 'acme', 1, 'instagram', '1784', 'Acme')");
  setSetting('setupComplete', true);
  setSetting('lang', 'en');
  setIdentity({ name: 'Pat Publisher', handle: 'pat' });
  const state = await createTeam({ folder: shared, name: 'Agency', encrypt: true, passphrase: 'team passphrase 1' });
  teamDir = state.folder;
});
afterAll(() => {
  __resetTeamForTests();
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('publisher', () => {
  it('creates the folder layout and publishes a first snapshot', () => {
    const s = getTeamState();
    expect(s.mode).toBe('publisher');
    expect(s.encrypted).toBe(true);
    expect(s.lastPublishAt).toBeTruthy();
    const team = JSON.parse(fs.readFileSync(path.join(teamDir, 'team.json'), 'utf8'));
    expect(team).toMatchObject({ name: 'Agency', formatVersion: 1, encrypted: true });
    expect(team.keyCheck).toBeTruthy();
    expect(JSON.stringify(team)).not.toContain('team passphrase 1');
    expect(fs.existsSync(path.join(teamDir, 'members', `${s.me.id}.json`))).toBe(true);
    expect(readManifest(teamDir).file.endsWith('.enc')).toBe(true);
    expect(getSession()).toMatchObject({ role: 'admin', readOnly: false, workspace: 'local' });
  });
});

describe('subscriber', () => {
  beforeAll(async () => {
    await asInstall(subHome);
    setSetting('lang', 'tr');
    setSetting('theme', 'light');
    setIdentity({ name: 'Sam Subscriber', handle: 'sam' });
  });

  it('refuses a wrong passphrase before touching anything', async () => {
    await expect(joinTeam({ folder: shared, passphrase: 'wrong wrong' })).rejects.toMatchObject({ code: 'TEAM_PASSPHRASE_WRONG' });
    expect(getDbPath()).toBe(subHome);
    expect(fs.existsSync(localDbPath())).toBe(false);
  });

  it('joins from the shared root, swaps to the workspace DB and becomes a read-only analyst', async () => {
    const s = await joinTeam({ folder: shared, passphrase: 'team passphrase 1' });
    expect(s.mode).toBe('subscriber');
    expect(getDbPath()).toContain(path.join('workspaces', s.teamId, 'data.db'));
    expect(hasLocalSettingsStore()).toBe(true);
    expect(q.get("SELECT username FROM accounts WHERE ig_id = '1784'").username).toBe('acme');
    expect(q.get("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'token:meta%'").n).toBe(0);
    expect(getSession()).toMatchObject({ role: 'analyst', readOnly: true, workspace: s.teamId });
    expect(s.me).toMatchObject({ handle: 'sam', isSelf: true });
    expect(s.members.map((m) => m.handle).sort()).toEqual(['pat', 'sam']);
    expect(() => check('sync:run', [{}], getSession())).toThrow();
  });

  it('keeps machine-local settings in local.db across a snapshot swap', async () => {
    expect(getSetting('lang')).toBe('tr');
    setSetting('ui.sidebar', 'narrow');
    const before = getTeamConfig().snapshotId;
    await fakeSnapshot(teamDir, (db) => {
      db.prepare("UPDATE accounts SET username = 'acme_new' WHERE ig_id = '1784'").run();
      db.prepare("INSERT INTO settings (key, value) VALUES ('lang', '\"de\"') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    });
    // the fake snapshot is plain; the team is encrypted — pulling still works because the file is not MDX1
    const s = await pullNow();
    expect(s.error).toBeNull();
    expect(getTeamConfig().snapshotId).not.toBe(before);
    expect(q.get("SELECT username FROM accounts WHERE ig_id = '1784'").username).toBe('acme_new');
    expect(getSetting('lang')).toBe('tr');
    expect(getSetting('theme')).toBe('light');
    expect(getSetting('ui.sidebar')).toBe('narrow');
    expect(q.get("SELECT is_self FROM team_members WHERE handle = 'sam'").is_self).toBe(1);
  });

  it('blocks a snapshot whose schema is newer than this build', async () => {
    const snap = getTeamConfig().snapshotId;
    await fakeSnapshot(teamDir, (db) => db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, 1)').run(supportedSchemaVersion() + 1), { schemaVersion: supportedSchemaVersion() + 1 });
    const s = await pullNow();
    expect(s.error).toBe(msg('team_schema_too_new', null, 'tr')); // this install runs in Turkish
    expect(getTeamConfig().snapshotId).toBe(snap);
    expect(q.get("SELECT username FROM accounts WHERE ig_id = '1784'").username).toBe('acme_new');
  });

  it('restores subscriber mode after a restart', async () => {
    await asInstall(subHome);
    expect(getDbPath()).toContain('workspaces');
    expect(getSession().readOnly).toBe(true);
    expect(getSetting('lang')).toBe('tr');
  });

  it('writes its notes to its own event log', () => {
    const n = addNoteV2({ entityType: 'account', entityId: '1784', body: '@pat please check reach' });
    expect(n.author_name).toBe('Sam Subscriber');
    const me = getTeamState().me;
    const log = fs.readFileSync(path.join(teamDir, 'events', `${me.id}.jsonl`), 'utf8');
    expect(log).toContain(n.uid);
    expect(n.mentions).toHaveLength(1);
  });
});

describe('back on the publisher', () => {
  it('applies subscriber events before publishing, so the note round-trips', async () => {
    await asInstall(pubHome);
    await publishNow();
    const row = q.get("SELECT body, origin, author_name FROM notes WHERE body LIKE '@pat%'");
    expect(row).toMatchObject({ origin: 'event', author_name: 'Sam Subscriber' });
    expect(q.get("SELECT is_self FROM team_members WHERE handle = 'pat'").is_self).toBe(1);
  });
});

describe('leaving', () => {
  it('returns the subscriber to its own database and settings', async () => {
    await asInstall(subHome);
    const teamId = getTeamConfig().teamId;
    const s = await leaveTeam({ keepCopy: false });
    expect(s.mode).toBe('none');
    expect(getDbPath()).toBe(subHome);
    expect(hasLocalSettingsStore()).toBe(false);
    expect(fs.existsSync(localDbPath())).toBe(false);
    expect(fs.existsSync(path.join(root, 'subscriber', 'workspaces', teamId))).toBe(false);
    expect(getSetting('lang')).toBe('tr');
    expect(getSession()).toMatchObject({ role: 'admin', readOnly: false, workspace: 'local' });
  });

  it('a publisher leaving keeps its data and stops publishing', async () => {
    await asInstall(pubHome);
    const s = await leaveTeam({});
    expect(s.mode).toBe('none');
    expect(q.get("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'token:team:%'").n).toBe(0);
    await expect(publishNow()).rejects.toMatchObject({ code: 'TEAM_NOT_PUBLISHER' });
  });
});
