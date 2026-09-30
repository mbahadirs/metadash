import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDbPath, reopenDb } from '../db/index.js';
import { getSetting, setSetting, deleteSetting, getAllSettings, isLocalKey, setLocalSettingsStore } from '../db/queries/settings.js';
import { selfMember, upsertMember, listMembers, newUid } from '../db/queries/team.js';
import { encryptString, decryptString } from '../config/store.js';
import { progressBus } from '../sync/progress.js';
import { teamError } from './errors.js';
import { getSession, sessionChanged } from './session.js';
import { deriveKey, makeKeyCheck, verifyKeyCheck, newKdfSalt } from './crypto.js';
import {
  FORMAT_VERSION, teamDirFor, teamJsonPath, membersDir, memberFilePath, resolveTeamDir, readJson, writeJsonAtomic, isConflictedCopy,
} from './folder.js';
import { readEventLogs, applyEvents, recordLocalEvent, makeEvent, appendEvent } from './events.js';
import { publishSnapshot } from './publish.js';
import { pullSnapshot, readManifest, workspaceDbPath } from './subscribe.js';
import { openLocalStore, removeLocalStore } from './localStore.js';

/**
 * Team workspace without a server (plan §5). One publisher (admin, owns tokens and sync) writes stripped snapshots
 * to a synced folder; subscribers pull them read-only; notes / inbox status travel as per-member event logs.
 * State lives in machine-local settings (team.config, team.identity, token:team:<teamId> = encrypted snapshot key).
 */
const CONFIG_KEY = 'team.config';
const IDENTITY_KEY = 'team.identity';
const PENDING_KEY = 'team.pendingEvents';
const MAX_PENDING = 500;
export const DEFAULT_PUBLISH_INTERVAL_MIN = 60;
export const POLL_INTERVAL_MS = 60_000;
const HANDLE_RE = /^[a-z0-9_.-]{2,32}$/i;
const keyRef = (teamId) => `token:team:${teamId}`;

const DEFAULT_CONFIG = Object.freeze({
  mode: 'none', teamId: null, name: null, folder: null, encrypted: false, publisherId: null,
  lastPublishAt: null, lastPullAt: null, snapshotId: null, snapshotAt: null, publisher: null, error: null,
  publishIntervalMin: DEFAULT_PUBLISH_INTERVAL_MIN,
});

const paths = { home: null };
let localStore = null;
let busy = null;
let syncListener = null;

// ---------- config / identity ----------

export function getTeamConfig() {
  return { ...DEFAULT_CONFIG, ...(getSetting(CONFIG_KEY, null) ?? {}) };
}

function saveConfig(patch) {
  const next = { ...getTeamConfig(), ...patch };
  setSetting(CONFIG_KEY, next);
  return next;
}

export function getIdentity() {
  const id = getSetting(IDENTITY_KEY, null);
  return id?.id ? id : null;
}

const userDataDir = () => path.dirname(paths.home ?? getDbPath());
export const localDbPath = () => path.join(userDataDir(), 'local.db');
export const workspaceDir = (teamId) => path.join(userDataDir(), 'workspaces', String(teamId));

function appVersion() {
  try {
    const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../package.json');
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

function emitStatus(state, cfg = getTeamConfig()) {
  progressBus.emit('team:status', { state, lastPublishAt: cfg.lastPublishAt, lastPullAt: cfg.lastPullAt, error: cfg.error });
}

const baseRole = () => (getSession().readOnly ? 'analyst' : getSession().role === 'analyst' ? 'analyst' : 'admin');

/** Keeps this machine's member row (is_self) in the open database in line with team.identity. */
export function ensureSelfMember() {
  const me = getIdentity();
  if (!me) return null;
  return upsertMember({ id: me.id, name: me.name, handle: me.handle, role: baseRole(), isSelf: true, updatedAt: me.updatedAt ?? Date.now() });
}

function writeOwnMemberFile(teamDir) {
  const me = getIdentity();
  if (!me || !teamDir) return;
  writeJsonAtomic(memberFilePath(teamDir, me.id), { id: me.id, name: me.name, handle: me.handle, role: baseRole(), updatedAt: me.updatedAt ?? Date.now() });
}

/** Imports members/<id>.json of the other members (the role there is informational). */
export function importMemberFiles(teamDir) {
  const me = getIdentity();
  let files = [];
  try { files = fs.readdirSync(membersDir(teamDir)); } catch { return 0; }
  let n = 0;
  for (const f of files) {
    if (!f.endsWith('.json') || isConflictedCopy(f)) continue;
    const m = readJson(path.join(membersDir(teamDir), f));
    if (!m?.id || `${m.id}.json` !== f || m.id === me?.id) continue;
    upsertMember({ id: m.id, name: String(m.name ?? '').slice(0, 80), handle: HANDLE_RE.test(m.handle ?? '') ? m.handle : null, role: m.role, updatedAt: m.updatedAt ?? null });
    n += 1;
  }
  return n;
}

export function setIdentity({ name, handle } = {}) {
  const cleanName = String(name ?? '').trim().slice(0, 80);
  const cleanHandle = String(handle ?? '').trim().replace(/^@/, '');
  if (!cleanName) throw teamError('TEAM_NAME_REQUIRED');
  if (!HANDLE_RE.test(cleanHandle)) throw teamError('TEAM_HANDLE_INVALID');
  const cur = getIdentity();
  const clash = listMembers().find((m) => m.handle.toLowerCase() === cleanHandle.toLowerCase() && m.id !== cur?.id);
  if (clash) throw teamError('TEAM_HANDLE_TAKEN');
  const next = { id: cur?.id ?? newUid(), name: cleanName, handle: cleanHandle, updatedAt: Date.now() };
  setSetting(IDENTITY_KEY, next);
  const member = ensureSelfMember();
  const cfg = getTeamConfig();
  if (cfg.mode !== 'none' && cfg.folder) {
    try { writeOwnMemberFile(cfg.folder); } catch (e) { console.error('[team] member file', e); }
  }
  return member;
}

// ---------- key ----------

function storeKey(teamId, key) {
  setSetting(keyRef(teamId), encryptString(key.toString('base64')));
}

function loadKey(cfg) {
  if (!cfg.encrypted) return null;
  const b64 = decryptString(getSetting(keyRef(cfg.teamId), null));
  if (!b64) throw teamError('TEAM_PASSPHRASE_REQUIRED');
  return Buffer.from(b64, 'base64');
}

// ---------- state ----------

export function getTeamState() {
  const cfg = getTeamConfig();
  let me = null;
  let members = [];
  try { me = selfMember(); members = listMembers(); } catch { /* db not open */ }
  return {
    mode: cfg.mode, teamId: cfg.teamId, name: cfg.name, folder: cfg.folder, encrypted: !!cfg.encrypted, me, members,
    lastPublishAt: cfg.lastPublishAt, lastPullAt: cfg.lastPullAt, snapshotAt: cfg.snapshotAt, publisher: cfg.publisher, error: cfg.error,
  };
}

/** Serialises publish / pull / join / leave (one at a time). */
async function exclusive(fn) {
  while (busy) await busy.catch(() => {});
  const p = (async () => fn())();
  busy = p;
  try { return await p; } finally { if (busy === p) busy = null; }
}

// ---------- events ----------

function flushPending(cfg, me) {
  const pending = getSetting(PENDING_KEY, []) ?? [];
  if (!pending.length) return;
  const left = [];
  for (const e of pending) {
    try { appendEvent(cfg.folder, me.id, e); } catch { left.push(e); }
  }
  if (left.length) setSetting(PENDING_KEY, left); else deleteSetting(PENDING_KEY);
}

/**
 * Records a local change for the team (notes, inbox status/assignment, mention seen): appended to our own event log
 * in the shared folder, or queued in team.pendingEvents while the folder is unreachable. No-op outside a team.
 * The change itself must already be written to the local database by the caller.
 */
export function recordTeamEvent(op, fields, at = Date.now()) {
  const cfg = getTeamConfig();
  const me = getIdentity();
  if (cfg.mode === 'none' || !cfg.folder || !me) return null;
  try {
    return recordLocalEvent(cfg.folder, me.id, op, fields, at);
  } catch (e) {
    console.error('[team] event queued', e?.message);
    const event = makeEvent(op, fields, { author: me.id, at });
    const pending = [...(getSetting(PENDING_KEY, []) ?? []), event].slice(-MAX_PENDING);
    setSetting(PENDING_KEY, pending);
    return event;
  }
}

/** Imports member files and applies every member's events (ours included, idempotent) to the open database. */
function syncFromFolder(cfg) {
  const me = getIdentity();
  if (me) flushPending(cfg, me);
  importMemberFiles(cfg.folder);
  return applyEvents(readEventLogs(cfg.folder), { selfId: me?.id ?? null });
}

// ---------- publisher ----------

export async function createTeam({ folder, name, encrypt = false, passphrase = null } = {}) {
  return exclusive(async () => {
    const cfg = getTeamConfig();
    if (cfg.mode !== 'none') throw teamError('TEAM_ALREADY_IN_TEAM');
    if (!getIdentity()) throw teamError('TEAM_IDENTITY_REQUIRED');
    const teamName = String(name ?? '').trim().slice(0, 80);
    if (!teamName) throw teamError('TEAM_TEAM_NAME_REQUIRED');
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw teamError('TEAM_FOLDER_MISSING');
    if (encrypt && String(passphrase ?? '').length < 8) throw teamError('TEAM_PASSPHRASE_SHORT');
    const teamId = newUid().slice(0, 16);
    const dir = teamDirFor(folder, teamId);
    fs.mkdirSync(dir, { recursive: true });
    const me = getIdentity();
    const kdfSalt = encrypt ? newKdfSalt() : null;
    const key = encrypt ? deriveKey(passphrase, kdfSalt) : null;
    writeJsonAtomic(teamJsonPath(dir), {
      teamId, name: teamName, formatVersion: FORMAT_VERSION, createdAt: Date.now(), publisherId: me.id,
      encrypted: !!encrypt, kdfSalt, keyCheck: key ? makeKeyCheck(key) : null,
    });
    if (key) storeKey(teamId, key);
    saveConfig({ ...DEFAULT_CONFIG, mode: 'publisher', teamId, name: teamName, folder: dir, encrypted: !!encrypt, publisherId: me.id });
    ensureSelfMember();
    writeOwnMemberFile(dir);
    await publishLocked();
    sessionChanged();
    return getTeamState();
  });
}

async function publishLocked() {
  const cfg = getTeamConfig();
  if (cfg.mode !== 'publisher') throw teamError('TEAM_NOT_PUBLISHER');
  emitStatus('publishing', cfg);
  try {
    syncFromFolder(cfg);
    const me = getIdentity();
    const manifest = await publishSnapshot({ teamDir: cfg.folder, key: loadKey(cfg), appVersion: appVersion(), publisher: me?.name || os.hostname() });
    const next = saveConfig({ lastPublishAt: Date.now(), snapshotId: manifest.snapshotId, snapshotAt: manifest.createdAt, publisher: manifest.publisher, error: null });
    emitStatus('idle', next);
    return manifest;
  } catch (e) {
    const next = saveConfig({ error: e?.message ?? String(e) });
    emitStatus('error', next);
    throw e;
  }
}

export async function publishNow() {
  await exclusive(publishLocked);
  return getTeamState();
}

// ---------- subscriber ----------

function afterSwap(manifest) {
  ensureSelfMember();
  saveConfig({ snapshotId: manifest.snapshotId, snapshotAt: manifest.createdAt, publisher: manifest.publisher ?? null });
}

async function pullLocked() {
  const cfg = getTeamConfig();
  if (cfg.mode === 'none') throw teamError('TEAM_NOT_IN_TEAM');
  emitStatus('pulling', cfg);
  try {
    let error = null;
    if (cfg.mode === 'subscriber') {
      const res = pullSnapshot({ teamDir: cfg.folder, key: loadKey(cfg), workspaceDir: workspaceDir(cfg.teamId), currentSnapshotId: cfg.snapshotId });
      if (res.status === 'updated') afterSwap(res.manifest);
      if (res.status === 'too_new') error = teamError('TEAM_SCHEMA_TOO_NEW').message;
    }
    syncFromFolder(getTeamConfig());
    const next = saveConfig({ lastPullAt: Date.now(), error });
    emitStatus(error ? 'error' : 'idle', next);
    return next;
  } catch (e) {
    const next = saveConfig({ error: e?.message ?? String(e) });
    emitStatus('error', next);
    throw e;
  }
}

export async function pullNow() {
  await exclusive(pullLocked);
  return getTeamState();
}

function copyLocalSettings(store) {
  for (const [k, v] of Object.entries(getAllSettings())) {
    if (!isLocalKey(k) || k.startsWith('session.') || k === CONFIG_KEY || k === PENDING_KEY) continue;
    store.set(k, JSON.stringify(v));
  }
}

function dropLocalStore() {
  setLocalSettingsStore(null);
  localStore?.close();
  localStore = null;
  removeLocalStore(localDbPath());
}

export async function joinTeam({ folder, passphrase = null } = {}) {
  return exclusive(async () => {
    if (getTeamConfig().mode !== 'none') throw teamError('TEAM_ALREADY_IN_TEAM');
    if (!getIdentity()) throw teamError('TEAM_IDENTITY_REQUIRED');
    if (!folder) throw teamError('TEAM_FOLDER_MISSING');
    let found;
    try { found = resolveTeamDir(folder); } catch (e) { throw teamError(e.code === 'TEAM_AMBIGUOUS' ? 'TEAM_AMBIGUOUS' : 'TEAM_NOT_FOUND'); }
    const { dir, team } = found;
    let key = null;
    if (team.encrypted) {
      if (!passphrase) throw teamError('TEAM_PASSPHRASE_REQUIRED');
      key = deriveKey(passphrase, team.kdfSalt);
      if (!verifyKeyCheck(key, team.keyCheck)) throw teamError('TEAM_PASSPHRASE_WRONG');
    }
    if (!readManifest(dir)) throw teamError('TEAM_NO_SNAPSHOT');
    paths.home = paths.home ?? getDbPath();
    removeLocalStore(localDbPath());
    localStore = openLocalStore(localDbPath());
    copyLocalSettings(localStore);
    setLocalSettingsStore(localStore);
    try {
      saveConfig({ ...DEFAULT_CONFIG, mode: 'subscriber', teamId: team.teamId, name: team.name, folder: dir, encrypted: !!team.encrypted, publisherId: team.publisherId ?? null });
      if (key) storeKey(team.teamId, key);
      const res = pullSnapshot({ teamDir: dir, key, workspaceDir: workspaceDir(team.teamId), force: true });
      if (res.status !== 'updated') {
        throw teamError(res.status === 'too_new' ? 'TEAM_SCHEMA_TOO_NEW' : res.status === 'partial' ? 'TEAM_SNAPSHOT_SYNCING' : 'TEAM_NO_SNAPSHOT');
      }
      afterSwap(res.manifest);
      syncFromFolder(getTeamConfig());
      writeOwnMemberFile(dir);
      saveConfig({ lastPullAt: Date.now() });
    } catch (e) {
      dropLocalStore();
      if (getDbPath() !== paths.home) reopenDb(paths.home);
      throw e;
    }
    sessionChanged();
    emitStatus('idle');
    return getTeamState();
  });
}

export async function leaveTeam({ keepCopy = false } = {}) {
  return exclusive(async () => {
    const cfg = getTeamConfig();
    if (cfg.mode === 'subscriber') {
      const identity = getIdentity();
      dropLocalStore();
      if (paths.home && getDbPath() !== paths.home) reopenDb(paths.home);
      if (identity) setSetting(IDENTITY_KEY, identity); // keep a name/handle chosen while subscribed
      if (!keepCopy) fs.rmSync(workspaceDir(cfg.teamId), { recursive: true, force: true });
    } else if (cfg.mode === 'publisher') {
      deleteSetting(keyRef(cfg.teamId));
      setSetting(CONFIG_KEY, { ...DEFAULT_CONFIG });
    }
    ensureSelfMember();
    sessionChanged();
    emitStatus('idle');
    return getTeamState();
  });
}

// ---------- timers / startup ----------

/** Periodic tick (team/scheduler.js): subscribers pull; the publisher publishes when due, otherwise merges events. */
export async function teamTick(now = Date.now()) {
  const cfg = getTeamConfig();
  if (cfg.mode === 'none' || busy) return null;
  try {
    if (cfg.mode === 'publisher') {
      const due = !cfg.lastPublishAt || now - cfg.lastPublishAt >= Math.max(5, Number(cfg.publishIntervalMin) || DEFAULT_PUBLISH_INTERVAL_MIN) * 60_000;
      return due ? await publishNow() : await pullNow();
    }
    return await pullNow();
  } catch (e) {
    console.error('[team] tick', e?.message ?? e);
    return null;
  }
}

function onSyncDone(payload) {
  if (getTeamConfig().mode !== 'publisher' || !['ok', 'partial'].includes(payload?.status)) return;
  publishNow().catch((e) => console.error('[team] publish after sync', e?.message ?? e));
}

/**
 * Called once after the home database opens (GUI and CLI): restores subscriber mode (local.db sidecar + workspace
 * database), marks our member row, applies the session scope and publishes after each successful sync.
 */
export async function initTeam({ homeDbPath } = {}) {
  paths.home = homeDbPath ?? getDbPath();
  const localFile = localDbPath();
  if (fs.existsSync(localFile)) {
    const store = openLocalStore(localFile);
    let cfg = null;
    try { cfg = JSON.parse(store.get(CONFIG_KEY) ?? 'null'); } catch { cfg = null; }
    const wsDb = cfg?.teamId ? workspaceDbPath(workspaceDir(cfg.teamId)) : null;
    if (cfg?.mode === 'subscriber' && wsDb && fs.existsSync(wsDb)) {
      localStore = store;
      setLocalSettingsStore(store);
      reopenDb(wsDb);
    } else {
      store.close();
    }
  }
  try { ensureSelfMember(); } catch (e) { console.error('[team] self member', e); }
  const session = sessionChanged();
  if (!syncListener) {
    syncListener = onSyncDone;
    progressBus.on('sync:done', syncListener);
  }
  return { workspace: session.workspace };
}

/** Test helper: forget module state (listeners, sidecar, paths). */
export function __resetTeamForTests() {
  if (syncListener) progressBus.off('sync:done', syncListener);
  syncListener = null;
  setLocalSettingsStore(null);
  localStore?.close();
  localStore = null;
  paths.home = null;
  busy = null;
}
