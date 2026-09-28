import crypto from 'node:crypto';
import { getSetting, setSetting, getAllSettings } from '../db/queries/settings.js';
import { machineId } from './machine.js';

/**
 * Secrets (Meta token, app secret) are encrypted at rest with AES-256-GCM.
 * The key is derived from the machine identifier, so the database is useless on another computer.
 * (Electron's safeStorage was deliberately avoided: on macOS it needs the Keychain and prompts for the
 * login password whenever an unsigned/re-signed build touches the entry.)
 */
const ENC_PREFIX = 'gcm:';
const LEGACY_PLAIN = 'plain:';
const KEY_SALT = 'metadash-store-v1';

export const DEFAULTS = {
  theme: 'dark',
  lang: 'en',
  autoSyncDaily: false,
  storyIntervalHours: 4,
  refreshTiers: { fresh: 48, recent: 24, month: 168, old: 720 },
  mediaLookbackDays: 365,
  disabledMetrics: [],
  setupStep: 0,
  lastPeriod: 28,
};

export function getConfig(key) {
  return getSetting(key, DEFAULTS[key] ?? null);
}

export function setConfig(key, value) {
  setSetting(key, value);
}

export function getAllConfig() {
  const all = getAllSettings();
  const ui = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('ui.')));
  return { ...ui, ...Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, getConfig(k)])) };
}

let keyCache = null;
function key() {
  if (!keyCache) keyCache = crypto.createHash('sha256').update(KEY_SALT + '|' + machineId()).digest();
  return keyCache;
}

export function encryptString(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptString(stored) {
  if (!stored) return null;
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
      decipher.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      return null; // different machine or corrupted → treat as missing
    }
  }
  if (stored.startsWith(LEGACY_PLAIN)) return Buffer.from(stored.slice(LEGACY_PLAIN.length), 'base64').toString('utf8');
  if (stored.startsWith('enc:')) return null; // old safeStorage entries are no longer readable
  return stored;
}

/** Stores a secret and returns the settings key that references it. */
export function storeToken(profileKey, token) {
  const ref = `token:${profileKey}`;
  setSetting(ref, token ? encryptString(token) : '');
  return ref;
}

export function readToken(ref) {
  const raw = getSetting(ref);
  if (!raw) return null;
  return decryptString(raw);
}

export function storeAppSecret(appId, secret) {
  return storeToken(`secret:${appId}`, secret);
}

export function readAppSecret(appId) {
  return readToken(`token:secret:${appId}`);
}
